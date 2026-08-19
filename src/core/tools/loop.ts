import { formatToolErrorTurn, formatToolResultTurn, parseToolCalls } from './protocol'
import type { ToolRunner } from './runner'
import { MAX_TOOL_ITERATIONS, type ToolResult } from './types'

export interface ToolLoopOptions {
  runner: ToolRunner
  workspaceId: string
  maxIterations?: number
  signal?: AbortSignal
  onToolResult?: (result: ToolResult, iteration: number) => void
}

export type GenerateFn = (transcript: readonly LoopTurn[]) => Promise<string>

export interface LoopTurn {
  role: 'assistant' | 'user'
  content: string
}

export interface ToolLoopResult {
  answer: string
  transcript: LoopTurn[]
  iterations: number
  results: ToolResult[]
  stoppedAtLimit: boolean
}

export const TOOL_LIMIT_NOTICE =
  'Tool-call limit reached: you have already made the maximum number of tool calls ' +
  'allowed for this turn, and no further calls will be executed. Answer now using ' +
  'the information you already have, and say plainly if it is not enough.'

export async function runToolLoop(
  generate: GenerateFn,
  options: ToolLoopOptions
): Promise<ToolLoopResult> {
  const limit = options.maxIterations ?? MAX_TOOL_ITERATIONS
  const transcript: LoopTurn[] = []
  const results: ToolResult[] = []

  let iterations = 0
  let answer = ''
  let stoppedAtLimit = false

  for (;;) {
    if (options.signal?.aborted) break

    const message = await generate(transcript)
    const parsed = parseToolCalls(message)
    answer = parsed.text

    const work = parsed.calls.length + parsed.errors.length
    if (work === 0) break

    if (iterations >= limit) {
      stoppedAtLimit = true
      transcript.push({ role: 'assistant', content: message })
      transcript.push({ role: 'user', content: TOOL_LIMIT_NOTICE })

      answer = parseToolCalls(await generate(transcript)).text
      break
    }

    iterations++
    transcript.push({ role: 'assistant', content: message })

    for (const error of parsed.errors) {
      transcript.push({
        role: 'user',
        content: formatToolErrorTurn(
          'unknown',
          `${error.message}. Re-emit the call as a fenced json block containing ` +
            '{"tool": "<name>", "args": { ... }} and nothing else.'
        )
      })
    }

    for (const call of parsed.calls) {
      const result = await options.runner.run(
        call.tool,
        call.args,
        options.workspaceId,
        options.signal
      )
      results.push(result)
      options.onToolResult?.(result, iterations)

      transcript.push({
        role: 'user',
        content: result.ok
          ? formatToolResultTurn(result.tool, result.content)
          : formatToolErrorTurn(result.tool, describeForModel(result))
      })
    }
  }

  return { answer, transcript, iterations, results, stoppedAtLimit }
}

function describeForModel(result: Extract<ToolResult, { ok: false }>): string {
  const { error } = result
  if (error.kind === 'validation_error' && error.issues?.length) {
    const fields = error.issues
      .map((issue) => `${issue.path || '(root)'}: ${issue.message}`)
      .join('; ')
    return `${error.message}. Fix these fields and call again: ${fields}`
  }
  return error.message
}
