import { ToolCallScanner, ToolProtocolError } from '../tools/protocol'
import { redact } from './redact'
import type { AiProvider, ChatRequest, ModelInfo, ProviderCapabilities, StreamEvent } from './types'

export type MockFailureMode = 'fail_at_chunk_3' | 'timeout' | 'malformed_tool_call'

export interface MockProviderOptions {
  seed?: number
  chunkDelayMs?: number
  chunkCount?: number
  failure?: MockFailureMode
  emitToolCall?: boolean
  models?: ModelInfo[]
  maxContextTokens?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

const LEXICON = [
  'the',
  'kestrel',
  'drifts',
  'over',
  'quiet',
  'water',
  'while',
  'evening',
  'settles',
  'into',
  'the',
  'reeds',
  'and',
  'a',
  'slow',
  'current',
  'turns',
  'the',
  'light',
  'sideways',
  'across',
  'the',
  'shallows'
] as const

const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'mock-small', family: 'mock', nodeCount: 1, tps: 999 },
  { id: 'mock-large', family: 'mock', nodeCount: 1, tps: 420 }
]

const FENCE = '`'.repeat(3)
const TOOL_BLOCK_OPEN = `\n${FENCE}tool_call\n`
const TOOL_BLOCK_CLOSE = `\n${FENCE}\n`

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) {
      resolve()
      return
    }
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })

export class MockProvider implements AiProvider {
  readonly id = 'mock'
  readonly capabilities: ProviderCapabilities

  readonly #seed: number
  readonly #chunkDelayMs: number
  readonly #chunkCount: number
  readonly #failure: MockFailureMode | undefined
  readonly #emitToolCall: boolean
  readonly #models: ModelInfo[]
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>

  constructor(options: MockProviderOptions = {}) {
    this.#seed = options.seed ?? 1
    this.#chunkDelayMs = options.chunkDelayMs ?? 0
    this.#chunkCount = options.chunkCount ?? 6
    this.#failure = options.failure
    this.#emitToolCall = options.emitToolCall ?? false
    this.#models = options.models ?? DEFAULT_MODELS
    this.#sleep = options.sleep ?? realSleep

    this.capabilities = {
      nativeTools: false,
      streaming: true,
      maxContextTokens: options.maxContextTokens ?? 8192
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [...this.#models]
  }

  expectedText(request: ChatRequest): string {
    return this.#chunks(request).join('')
  }

  #chunks(request: ChatRequest): string[] {
    const seed = this.#seed ^ hash(`${request.model} ${serialise(request)}`)
    const random = mulberry32(seed)
    const chunks: string[] = []
    for (let i = 0; i < this.#chunkCount; i++) {
      const word = LEXICON[Math.floor(random() * LEXICON.length)]!
      chunks.push(i === 0 ? word : ` ${word}`)
    }
    return chunks
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const chunks = this.#chunks(request)
    const scanner = new ToolCallScanner()
    let completionTokens = 0

    if (signal.aborted) {
      yield { type: 'done', finishReason: 'cancelled' }
      return
    }

    for (let index = 0; index < chunks.length; index++) {
      if (this.#chunkDelayMs > 0) await this.#sleep(this.#chunkDelayMs, signal)
      if (signal.aborted) {
        yield { type: 'done', finishReason: 'cancelled' }
        return
      }

      if (this.#failure === 'fail_at_chunk_3' && index === 2) {
        yield {
          type: 'error',
          code: 'provider',
          message: redact('mock: injected provider failure at chunk 3'),
          retryable: true
        }
        yield { type: 'done', finishReason: 'error' }
        return
      }

      if (this.#failure === 'timeout' && index === 2) {
        yield {
          type: 'error',
          code: 'timeout',
          message: redact('mock: injected timeout waiting for chunk 3'),
          retryable: true
        }
        yield { type: 'done', finishReason: 'error' }
        return
      }

      const raw = this.#chunkText(chunks, index)

      let scanned
      try {
        scanned = scanner.push(raw)
      } catch (cause) {
        yield* this.#protocolFailure(cause)
        return
      }

      if (scanned.text) {
        completionTokens += estimateTokens(scanned.text)
        yield { type: 'delta', text: scanned.text }
      }
      for (const [n, call] of scanned.calls.entries()) {
        yield { type: 'tool_call', id: `mock-call-${index}-${n}`, name: call.tool, args: call.args }
      }
    }

    try {
      const tail = scanner.flush()
      if (tail.text) {
        completionTokens += estimateTokens(tail.text)
        yield { type: 'delta', text: tail.text }
      }
    } catch (cause) {
      yield* this.#protocolFailure(cause)
      return
    }

    yield {
      type: 'usage',
      promptTokens: estimateTokens(request.messages.map((m) => m.content).join(' ')),
      completionTokens
    }
    yield { type: 'done', finishReason: 'stop' }
  }

  #chunkText(chunks: readonly string[], index: number): string {
    if (index !== 2) return chunks[index]!

    if (this.#failure === 'malformed_tool_call') {
      return `${TOOL_BLOCK_OPEN}{"tool": "document_search", "args": {oops}${TOOL_BLOCK_CLOSE}`
    }
    if (this.#emitToolCall) {
      return `${TOOL_BLOCK_OPEN}{"tool": "document_search", "args": {"query": "kestrel"}}${TOOL_BLOCK_CLOSE}`
    }
    return chunks[index]!
  }

  *#protocolFailure(cause: unknown): Generator<StreamEvent> {
    yield {
      type: 'error',
      code: 'provider',
      message: redact(
        cause instanceof ToolProtocolError || cause instanceof Error
          ? cause.message
          : `mock: ${String(cause)}`
      ),

      retryable: false
    }
    yield { type: 'done', finishReason: 'error' }
  }
}

function serialise(request: ChatRequest): string {
  return request.messages.map((message) => `${message.role}:${message.content}`).join('\n')
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4))
}
