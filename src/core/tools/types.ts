import type { z } from 'zod'

export interface ToolContext {
  readonly workspaceId: string
  readonly signal: AbortSignal
  readonly logger: ToolLogger
}

export interface ToolLogger {
  (line: string): void
}

export interface Tool<A, R> {
  readonly name: string
  readonly description: string
  readonly schema: z.ZodType<A>
  jsonSchema(): object
  readonly requiresWorkspace: true
  readonly timeoutMs?: number
  execute(args: A, ctx: ToolContext): Promise<R>
}

export type AnyTool = Tool<never, unknown>

export type ToolOutcome =
  'ok' | 'validation_error' | 'timeout' | 'error' | 'unknown_tool' | 'cancelled'

export interface ToolInvocation {
  readonly tool: string
  readonly argsRedacted: string
  readonly durationMs: number
  readonly outcome: ToolOutcome
}

export type ToolResult =
  | {
      ok: true
      tool: string
      content: string
      truncated: boolean
      durationMs: number
    }
  | {
      ok: false
      tool: string
      error: ToolErrorPayload
      durationMs: number
    }

export interface ToolErrorPayload {
  kind: ToolOutcome
  message: string
  issues?: { path: string; message: string; code?: string }[]
}

export class ToolValidationError extends Error {
  constructor(
    readonly tool: string,
    readonly issues: { path: string; message: string; code?: string }[]
  ) {
    super(
      `Invalid arguments for tool "${tool}": ` +
        issues.map((issue) => `${issue.path || '(root)'} — ${issue.message}`).join('; ')
    )
    this.name = 'ToolValidationError'
  }
}

export class ToolTimeoutError extends Error {
  constructor(
    readonly tool: string,
    readonly timeoutMs: number
  ) {
    super(`Tool "${tool}" exceeded its ${timeoutMs}ms time limit and was stopped`)
    this.name = 'ToolTimeoutError'
  }
}

export class UnknownToolError extends Error {
  constructor(
    readonly requested: string,
    readonly available: string[]
  ) {
    super(
      `No tool named "${requested}". Available tools: ${available.join(', ') || '(none registered)'}`
    )
    this.name = 'UnknownToolError'
  }
}

export const MAX_RESULT_TOKENS = 4000

export const DEFAULT_TOOL_TIMEOUT_MS = 5_000

export const MAX_TOOL_ITERATIONS = 5

export interface ToolActivitySink {
  record(invocation: ToolInvocation): void
}
