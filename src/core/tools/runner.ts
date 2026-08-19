import type { z } from 'zod'
import { redact } from '../ai/redact'
import { defaultTokenCounter } from '../context/tokens'
import type { TokenCounter } from '../context/types'
import type { ToolRegistry } from './registry'
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  MAX_RESULT_TOKENS,
  ToolTimeoutError,
  ToolValidationError,
  UnknownToolError,
  type AnyTool,
  type ToolActivitySink,
  type ToolContext,
  type ToolErrorPayload,
  type ToolLogger,
  type ToolOutcome,
  type ToolResult
} from './types'

export interface ToolRunnerOptions {
  registry: ToolRegistry
  activity?: ToolActivitySink
  logger?: ToolLogger
  counter?: TokenCounter
  defaultTimeoutMs?: number
  now?: () => number
}

export class ToolRunner {
  readonly #registry: ToolRegistry
  readonly #activity: ToolActivitySink | undefined
  readonly #logger: ToolLogger
  readonly #counter: TokenCounter
  readonly #defaultTimeoutMs: number
  readonly #now: () => number

  constructor(options: ToolRunnerOptions) {
    this.#registry = options.registry
    this.#activity = options.activity
    this.#logger = options.logger ?? (() => {})
    this.#counter = options.counter ?? defaultTokenCounter
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
    this.#now = options.now ?? Date.now
  }

  async run(
    toolName: string,
    rawArgs: unknown,
    workspaceId: string,
    outerSignal?: AbortSignal
  ): Promise<ToolResult> {
    const started = this.#now()
    const argsRedacted = redact(rawArgs)

    const finish = (result: ToolResult, outcome: ToolOutcome): ToolResult => {
      this.#activity?.record({
        tool: toolName,
        argsRedacted,
        durationMs: result.durationMs,
        outcome
      })
      return result
    }

    const tool = this.#registry.get(toolName)
    if (!tool) {
      const error = new UnknownToolError(toolName, this.#registry.names())
      return finish(
        {
          ok: false,
          tool: toolName,
          error: { kind: 'unknown_tool', message: error.message },
          durationMs: this.#now() - started
        },
        'unknown_tool'
      )
    }

    const parsed = (tool.schema as z.ZodType<unknown>).safeParse(rawArgs ?? {})
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
        code: issue.code
      }))
      const error = new ToolValidationError(tool.name, issues)
      this.#logger(redact(`[tools] ${tool.name} rejected arguments: ${error.message}`))

      return finish(
        {
          ok: false,
          tool: tool.name,
          error: { kind: 'validation_error', message: error.message, issues },
          durationMs: this.#now() - started
        },
        'validation_error'
      )
    }

    const timeoutMs = tool.timeoutMs ?? this.#defaultTimeoutMs
    const controller = new AbortController()
    const onOuterAbort = (): void => controller.abort(outerSignal?.reason)
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new ToolTimeoutError(tool.name, timeoutMs))
    }, timeoutMs)

    const ctx: ToolContext = {
      workspaceId,
      signal: controller.signal,
      logger: this.#logger
    }

    try {
      const value = await Promise.race([
        (tool as AnyTool).execute(parsed.data as never, ctx),
        rejectOnAbort(controller.signal)
      ])

      if (timedOut) throw new ToolTimeoutError(tool.name, timeoutMs)

      const { content, truncated } = this.#serialise(value)
      const durationMs = this.#now() - started

      if (truncated) {
        this.#logger(`[tools] ${tool.name} result truncated to ${MAX_RESULT_TOKENS} tokens`)
      }

      return finish({ ok: true, tool: tool.name, content, truncated, durationMs }, 'ok')
    } catch (cause) {
      const durationMs = this.#now() - started
      const payload = describeFailure(cause, tool, timeoutMs, timedOut, outerSignal)
      this.#logger(redact(`[tools] ${tool.name} failed (${payload.kind}): ${payload.message}`))

      return finish({ ok: false, tool: tool.name, error: payload, durationMs }, payload.kind)
    } finally {
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', onOuterAbort)
    }
  }

  #serialise(value: unknown): { content: string; truncated: boolean } {
    const full = typeof value === 'string' ? value : safeStringify(value)
    if (this.#counter.count(full) <= MAX_RESULT_TOKENS) {
      return { content: full, truncated: false }
    }

    const notice =
      `\n\n[truncated: the full result exceeded ${MAX_RESULT_TOKENS} tokens. ` +
      'Narrow the query or request fewer items to see the rest.]'
    const budget = MAX_RESULT_TOKENS - this.#counter.count(notice)

    let low = 0
    let high = full.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (this.#counter.count(full.slice(0, mid)) <= budget) low = mid
      else high = mid - 1
    }

    return { content: full.slice(0, low).trimEnd() + notice, truncated: true }
  }
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function describeFailure(
  cause: unknown,
  tool: AnyTool,
  timeoutMs: number,
  timedOut: boolean,
  outerSignal: AbortSignal | undefined
): ToolErrorPayload {
  if (cause instanceof ToolTimeoutError || timedOut) {
    return {
      kind: 'timeout',
      message: new ToolTimeoutError(tool.name, timeoutMs).message
    }
  }
  if (outerSignal?.aborted) {
    return { kind: 'cancelled', message: `Tool "${tool.name}" was cancelled` }
  }
  if (cause instanceof ToolValidationError) {
    return { kind: 'validation_error', message: cause.message, issues: cause.issues }
  }

  const message = cause instanceof Error ? cause.message : String(cause)
  return { kind: 'error', message: redact(`${tool.name} failed: ${message}`) }
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(
        value,
        (_key, item: unknown) => {
          if (typeof item === 'bigint') return item.toString()
          if (typeof item === 'object' && item !== null) {
            if (seen.has(item)) return '[circular]'
            seen.add(item)
          }
          return item
        },
        2
      ) ?? String(value)
    )
  } catch {
    return String(value)
  }
}
