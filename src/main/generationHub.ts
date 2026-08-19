import type { ChatRequest, GenerationController, GenerationOutcome, StreamEvent } from '@core/ai'
import type { ContextReport } from '@core/context'

export interface GenerationSnapshot {
  conversationId: string
  generating: boolean
  text: string
  toolCalls: HubToolCall[]
  startedAt: number | undefined
  lastOutcome: 'complete' | 'cancelled' | 'error' | undefined
  lastError: string | undefined
}

export interface HubToolCall {
  id: string
  name: string
  args: unknown
}

export type HubEvent =
  | { type: 'delta'; conversationId: string; text: string }
  | { type: 'tool_call'; conversationId: string; call: HubToolCall }
  | { type: 'state'; conversationId: string; generating: boolean }
  | {
      type: 'settled'
      conversationId: string
      outcome: 'complete' | 'cancelled' | 'error'
      messageId?: string
      error?: string
    }

export type Broadcast = (event: HubEvent) => void

interface Live {
  text: string
  toolCalls: HubToolCall[]
  startedAt: number
}

export interface GenerationHubOptions {
  controllerFor: (workspaceId: string) => GenerationController
  broadcast: Broadcast
  now?: () => number
}

export class GenerationHub {
  readonly #controllerFor: (workspaceId: string) => GenerationController
  readonly #controllers = new Map<string, GenerationController>()
  readonly #broadcast: Broadcast
  readonly #now: () => number

  readonly #workspaceOf = new Map<string, string>()

  readonly #live = new Map<string, Live>()
  readonly #settled = new Map<
    string,
    { outcome: 'complete' | 'cancelled' | 'error'; error?: string }
  >()
  readonly #reports = new Map<string, ContextReport>()

  constructor(options: GenerationHubOptions) {
    this.#controllerFor = options.controllerFor
    this.#broadcast = options.broadcast
    this.#now = options.now ?? Date.now
  }

  #controller(workspaceId: string): GenerationController {
    let controller = this.#controllers.get(workspaceId)
    if (!controller) {
      controller = this.#controllerFor(workspaceId)
      this.#controllers.set(workspaceId, controller)
    }
    return controller
  }

  isGenerating(conversationId: string): boolean {
    return this.#live.has(conversationId)
  }

  activeConversationIds(): string[] {
    return [...this.#live.keys()]
  }

  snapshot(conversationId: string): GenerationSnapshot {
    const live = this.#live.get(conversationId)
    const settled = this.#settled.get(conversationId)

    return {
      conversationId,
      generating: live !== undefined,
      text: live?.text ?? '',
      toolCalls: live?.toolCalls ?? [],
      startedAt: live?.startedAt,
      lastOutcome: settled?.outcome,
      lastError: settled?.error
    }
  }

  report(conversationId: string): ContextReport | undefined {
    return this.#reports.get(conversationId)
  }

  rememberReport(conversationId: string, report: ContextReport): void {
    this.#reports.set(conversationId, report)
  }

  cancel(conversationId: string): boolean {
    const workspaceId = this.#workspaceOf.get(conversationId)
    if (!workspaceId) return false
    return this.#controller(workspaceId).cancel(conversationId)
  }

  async start(
    workspaceId: string,
    conversationId: string,
    request: ChatRequest,
    mode:
      | { kind: 'new' }
      | { kind: 'retry'; previousMessageId: string }
      | { kind: 'continue'; partialMessageId: string } = {
      kind: 'new'
    }
  ): Promise<GenerationOutcome> {
    this.#workspaceOf.set(conversationId, workspaceId)
    this.#live.set(conversationId, { text: '', toolCalls: [], startedAt: this.#now() })
    this.#settled.delete(conversationId)
    this.#broadcast({ type: 'state', conversationId, generating: true })

    const handlers = {
      onDelta: (text: string): void => {
        const live = this.#live.get(conversationId)
        if (!live) return
        live.text += text
        this.#broadcast({ type: 'delta', conversationId, text })
      },
      onToolCall: (call: HubToolCall): void => {
        this.#live.get(conversationId)?.toolCalls.push(call)
        this.#broadcast({ type: 'tool_call', conversationId, call })
      },
      onEvent: (_event: StreamEvent): void => {}
    }

    const controller = this.#controller(workspaceId)

    try {
      const outcome =
        mode.kind === 'retry'
          ? await controller.retry(conversationId, mode.previousMessageId, request, handlers)
          : mode.kind === 'continue'
            ? await controller.continue(conversationId, mode.partialMessageId, request, handlers)
            : await controller.start({ conversationId, request, handlers })

      const settled =
        outcome.status === 'complete'
          ? { outcome: 'complete' as const }
          : outcome.status === 'cancelled'
            ? { outcome: 'cancelled' as const }
            : { outcome: 'error' as const, error: outcome.message }

      this.#settled.set(conversationId, settled)
      this.#live.delete(conversationId)

      this.#broadcast({ type: 'state', conversationId, generating: false })
      this.#broadcast({
        type: 'settled',
        conversationId,
        outcome: settled.outcome,
        ...(outcome.status !== 'error' && outcome.message ? { messageId: outcome.message.id } : {}),
        ...(settled.error ? { error: settled.error } : {})
      })

      return outcome
    } catch (cause) {
      this.#live.delete(conversationId)
      const message = cause instanceof Error ? cause.message : String(cause)
      this.#settled.set(conversationId, { outcome: 'error', error: message })
      this.#broadcast({ type: 'state', conversationId, generating: false })
      this.#broadcast({ type: 'settled', conversationId, outcome: 'error', error: message })
      throw cause
    }
  }
}
