import type { MessageRow } from '../persistence'
import type { MessageRepository } from '../persistence'
import type { DriftTracker } from '../context/tokens'
import { redact } from './redact'
import type {
  AiProvider,
  ChatMessage,
  ChatRequest,
  FinishReason,
  StreamEvent,
  StreamErrorCode
} from './types'

export function isPartial(message: Pick<MessageRow, 'status' | 'content'>): boolean {
  return message.status === 'cancelled' && message.content.length > 0
}

export const CONTINUE_DIRECTIVE =
  'Continue the previous assistant message from exactly where it stopped. ' +
  'Do not repeat any text you have already written, do not restate the question, ' +
  'and do not start over — resume mid-sentence if that is where it ended.'

export type GenerationOutcome =
  | { status: 'complete'; message: MessageRow; usage?: Usage }
  | { status: 'cancelled'; message: MessageRow | undefined; text: string }
  | { status: 'error'; code: StreamErrorCode; message: string; retryable: boolean }

export interface Usage {
  promptTokens: number
  completionTokens: number
}

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface GenerationHandlers {
  onDelta?: (text: string, conversationId: string) => void
  onToolCall?: (call: ToolCall, conversationId: string) => void
  onEvent?: (event: StreamEvent, conversationId: string) => void
}

export interface GenerationControllerOptions {
  provider: AiProvider
  messages: MessageRepository
  newId: () => string
  now?: () => Date
  log?: (line: string) => void
  driftTracker?: DriftTracker
}

export interface StartOptions {
  conversationId: string
  request: ChatRequest
  handlers?: GenerationHandlers
  prevMessageId?: string
  promptTokenEstimate?: number
}

interface ActiveGeneration {
  controller: AbortController
  startedAt: number
}

export class GenerationBusyError extends Error {
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} already has a generation in flight`)
    this.name = 'GenerationBusyError'
  }
}

export class GenerationController {
  readonly #provider: AiProvider
  readonly #messages: MessageRepository
  readonly #newId: () => string
  readonly #now: () => Date
  readonly #log: (line: string) => void
  readonly #driftTracker: DriftTracker | undefined

  readonly #active = new Map<string, ActiveGeneration>()

  constructor(options: GenerationControllerOptions) {
    this.#provider = options.provider
    this.#messages = options.messages
    this.#newId = options.newId
    this.#now = options.now ?? (() => new Date())
    this.#log = options.log ?? (() => {})
    this.#driftTracker = options.driftTracker
  }

  isGenerating(conversationId: string): boolean {
    return this.#active.has(conversationId)
  }

  activeConversationIds(): string[] {
    return [...this.#active.keys()]
  }

  cancel(conversationId: string): boolean {
    const active = this.#active.get(conversationId)
    if (!active) return false
    active.controller.abort()
    return true
  }

  cancelAll(): void {
    for (const active of this.#active.values()) active.controller.abort()
  }

  async start(options: StartOptions): Promise<GenerationOutcome> {
    const { conversationId, request, handlers } = options

    if (this.#active.has(conversationId)) throw new GenerationBusyError(conversationId)

    const controller = new AbortController()
    this.#active.set(conversationId, { controller, startedAt: Date.now() })

    let text = ''
    let usage: Usage | undefined
    let failure: { code: StreamErrorCode; message: string; retryable: boolean } | undefined
    let finishReason: FinishReason | undefined

    try {
      for await (const event of this.#provider.stream(request, controller.signal)) {
        handlers?.onEvent?.(event, conversationId)

        switch (event.type) {
          case 'delta':
            text += event.text
            handlers?.onDelta?.(event.text, conversationId)
            break
          case 'tool_call':
            handlers?.onToolCall?.(
              { id: event.id, name: event.name, args: event.args },
              conversationId
            )
            break
          case 'usage':
            usage = { promptTokens: event.promptTokens, completionTokens: event.completionTokens }

            if (options.promptTokenEstimate !== undefined) {
              this.#driftTracker?.record(
                options.promptTokenEstimate,
                event.promptTokens,
                request.model
              )
            }
            break
          case 'error':
            failure = { code: event.code, message: event.message, retryable: event.retryable }
            break
          case 'done':
            finishReason = event.finishReason
            break
        }
      }
    } finally {
      this.#active.delete(conversationId)
    }

    if (finishReason === 'cancelled' || controller.signal.aborted) {
      if (!text) {
        return { status: 'cancelled', message: undefined, text: '' }
      }
      const message = this.#persist(options, text, 'cancelled', usage)
      this.#log(redact(`[gen] ${conversationId} cancelled after ${text.length} chars`))
      return { status: 'cancelled', message, text }
    }

    if (failure) {
      this.#log(redact(`[gen] ${conversationId} failed (${failure.code}): ${failure.message}`))
      return { status: 'error', ...failure }
    }

    const message = this.#persist(options, text, 'complete', usage)
    return { status: 'complete', message, ...(usage ? { usage } : {}) }
  }

  async retry(
    conversationId: string,
    previousMessageId: string,
    request: ChatRequest,
    handlers?: GenerationHandlers
  ): Promise<GenerationOutcome> {
    const previous = this.#messages.find(previousMessageId)
    if (!previous) throw new Error(`Cannot retry unknown message ${previousMessageId}`)
    if (previous.conversationId !== conversationId) {
      throw new Error(
        `Message ${previousMessageId} does not belong to conversation ${conversationId}`
      )
    }

    return this.start({
      conversationId,
      request,
      prevMessageId: previousMessageId,
      ...(handlers ? { handlers } : {})
    })
  }

  async continue(
    conversationId: string,
    partialMessageId: string,
    request: ChatRequest,
    handlers?: GenerationHandlers
  ): Promise<GenerationOutcome> {
    const partial = this.#messages.find(partialMessageId)
    if (!partial) throw new Error(`Cannot continue unknown message ${partialMessageId}`)
    if (partial.conversationId !== conversationId) {
      throw new Error(
        `Message ${partialMessageId} does not belong to conversation ${conversationId}`
      )
    }
    if (!isPartial(partial)) {
      throw new Error(
        `Message ${partialMessageId} is not a partial (status='${partial.status}', ` +
          `${partial.content.length} chars) — only a cancelled message with text can be continued`
      )
    }

    const messages: ChatMessage[] = [
      ...request.messages,
      { role: 'assistant', content: partial.content },
      { role: 'user', content: CONTINUE_DIRECTIVE }
    ]

    return this.start({
      conversationId,
      request: { ...request, messages },
      prevMessageId: partialMessageId,
      ...(handlers ? { handlers } : {})
    })
  }

  #persist(
    options: StartOptions,
    text: string,
    status: 'complete' | 'cancelled',
    usage: Usage | undefined
  ): MessageRow {
    return this.#messages.append({
      id: this.#newId(),
      conversationId: options.conversationId,
      role: 'assistant',
      content: text,
      status,
      tokenEstimate: usage?.completionTokens ?? null,
      createdAt: this.#now().toISOString(),
      prevMessageId: options.prevMessageId ?? null,
      provenanceJson: JSON.stringify({
        providerId: this.#provider.id,
        model: options.request.model,
        nativeTools: this.#provider.capabilities.nativeTools,
        ...(usage ? { usage } : {})
      })
    })
  }
}
