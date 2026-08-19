import type { AnyTool } from './types'

export interface ToolDescriptor {
  name: string
  description: string
  parameters: object
}

export function describeTool(tool: AnyTool): ToolDescriptor {
  return { name: tool.name, description: tool.description, parameters: tool.jsonSchema() }
}

export const TOOL_FENCES = ['json', 'tool_call', 'tool'] as const

const FENCE = '`'.repeat(3)

const BLOCK = new RegExp(
  `${FENCE}[ \\t]*(json|tool_call|tool)?[ \\t]*\\r?\\n([\\s\\S]*?)${FENCE}`,
  'gi'
)

export interface ParsedToolCall {
  tool: string
  args: unknown
  raw: string
}

export interface ToolCallParseError {
  raw: string
  message: string
}

export interface ProtocolParseResult {
  text: string
  calls: ParsedToolCall[]
  errors: ToolCallParseError[]
}

export function parseToolCalls(message: string): ProtocolParseResult {
  const calls: ParsedToolCall[] = []
  const errors: ToolCallParseError[] = []
  let text = message

  for (const match of message.matchAll(BLOCK)) {
    const raw = match[0]
    const label = (match[1] ?? '').toLowerCase()
    const body = (match[2] ?? '').trim()
    if (!body) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch (cause) {
      if (label === 'tool_call' || label === 'tool') {
        errors.push({
          raw,
          message: `Not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
        })
        text = text.replace(raw, '')
      }
      continue
    }

    if (!isRecord(parsed)) {
      if (label === 'tool_call' || label === 'tool') {
        errors.push({ raw, message: 'Expected a JSON object with a "tool" field' })
        text = text.replace(raw, '')
      }
      continue
    }

    const name = parsed['tool'] ?? parsed['name']
    if (typeof name !== 'string' || !name.trim()) {
      if (label === 'tool_call' || label === 'tool') {
        errors.push({ raw, message: 'Missing a string "tool" field naming the tool to call' })
        text = text.replace(raw, '')
      }
      continue
    }

    const args = parsed['args'] ?? parsed['arguments'] ?? {}
    if (args !== undefined && args !== null && !isRecord(args)) {
      errors.push({ raw, message: `"args" must be a JSON object, received ${typeof args}` })
      text = text.replace(raw, '')
      continue
    }

    calls.push({ tool: name.trim(), args: args ?? {}, raw })
    text = text.replace(raw, '')
  }

  return { text: text.trim(), calls, errors }
}

export function buildToolInstructions(tools: readonly ToolDescriptor[]): string {
  if (tools.length === 0) return ''

  const catalogue = tools
    .map((tool) =>
      [
        `### ${tool.name}`,
        tool.description,
        'Arguments (JSON Schema):',
        JSON.stringify(tool.parameters)
      ].join('\n')
    )
    .join('\n\n')

  return [
    'TOOLS',
    '',
    'You can call a tool by emitting a fenced block containing a single JSON',
    'object. Emit nothing else in that block:',
    '',
    `${FENCE}json`,
    '{"tool": "<tool name>", "args": { ... }}',
    FENCE,
    '',
    'Rules:',
    '  - one call per block; emit several blocks to make several calls;',
    '  - "args" must match the tool\'s schema exactly. If a call comes back as an',
    '    error, read the error and correct the arguments — do not repeat the same',
    '    call unchanged;',
    '  - never invent a workspace id, a user id or any identifier: the workspace',
    '    is supplied by the application and arguments claiming otherwise are',
    '    ignored;',
    '  - wait for the tool result before continuing your answer;',
    '  - if no tool fits, just answer normally.',
    '',
    'Available tools:',
    '',
    catalogue
  ].join('\n')
}

export function formatToolResultTurn(tool: string, body: string): string {
  return [`${FENCE}tool_result`, JSON.stringify({ tool, result: body }), FENCE].join('\n')
}

export function formatToolErrorTurn(tool: string, error: string): string {
  return [`${FENCE}tool_error`, JSON.stringify({ tool, error }), FENCE].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class ToolProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolProtocolError'
  }
}

export function parseToolCallBody(body: string): { tool: string; args: unknown } {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.trim())
  } catch (cause) {
    throw new ToolProtocolError(
      `Malformed tool call block: ${cause instanceof Error ? cause.message : String(cause)}`
    )
  }

  if (!isRecord(parsed)) {
    throw new ToolProtocolError('Malformed tool call block: expected a JSON object')
  }

  const name = parsed['tool'] ?? parsed['name']
  if (typeof name !== 'string' || !name.trim()) {
    throw new ToolProtocolError('Malformed tool call block: missing a string "tool" field')
  }

  const args = parsed['args'] ?? parsed['arguments'] ?? {}
  return { tool: name.trim(), args }
}

const OPENERS = TOOL_FENCES.map((label) => `${FENCE}${label}`)
const CLOSE = FENCE

export class ToolCallScanner {
  #buffer = ''
  #inBlock = false

  push(chunk: string): { text: string; calls: { tool: string; args: unknown }[] } {
    this.#buffer += chunk
    const calls: { tool: string; args: unknown }[] = []
    let text = ''

    for (;;) {
      if (!this.#inBlock) {
        const found = firstOpener(this.#buffer)
        if (!found) {
          const keep = partialFenceLength(this.#buffer)
          if (this.#buffer.length > keep) {
            text += this.#buffer.slice(0, this.#buffer.length - keep)
            this.#buffer = this.#buffer.slice(this.#buffer.length - keep)
          }
          break
        }
        text += this.#buffer.slice(0, found.at)
        this.#buffer = this.#buffer.slice(found.at + found.opener.length)
        this.#inBlock = true
      }

      const close = this.#buffer.indexOf(CLOSE)
      if (close === -1) break

      const body = this.#buffer.slice(0, close)
      this.#buffer = this.#buffer.slice(close + CLOSE.length)
      this.#inBlock = false
      calls.push(parseToolCallBody(body))
    }

    return { text, calls }
  }

  flush(): { text: string; calls: { tool: string; args: unknown }[] } {
    if (this.#inBlock) {
      throw new ToolProtocolError('Stream ended inside an unterminated tool call block')
    }
    const text = this.#buffer
    this.#buffer = ''
    return { text, calls: [] }
  }
}

function firstOpener(buffer: string): { at: number; opener: string } | undefined {
  let best: { at: number; opener: string } | undefined
  for (const opener of OPENERS) {
    const at = buffer.indexOf(opener)
    if (at !== -1 && (best === undefined || at < best.at)) best = { at, opener }
  }
  return best
}

function partialFenceLength(buffer: string): number {
  let longest = 0
  for (const opener of OPENERS) {
    const max = Math.min(buffer.length, opener.length - 1)
    for (let k = max; k > longest; k--) {
      if (buffer.endsWith(opener.slice(0, k))) {
        longest = k
        break
      }
    }
  }
  return longest
}
