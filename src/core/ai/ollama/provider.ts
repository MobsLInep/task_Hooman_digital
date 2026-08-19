import { redact } from '../redact'
import { buildToolInstructions, ToolCallScanner, ToolProtocolError } from '../../tools/protocol'
import type {
  AiProvider,
  ChatMessage,
  ChatRequest,
  ModelInfo,
  ProviderCapabilities,
  StreamEvent
} from '../types'
import { NodePool, type NodeEntry, type NodeRegistry } from './nodePool'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface OllamaProviderOptions {
  registry: NodeRegistry
  fetch?: FetchLike
  pool?: NodePool
  requestTimeoutMs?: number
  modelCacheMs?: number
  maxContextTokens?: number
  now?: () => number
  log?: (line: string) => void
}

interface OllamaLine {
  message?: { content?: string; role?: string }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

export class OllamaNodePoolProvider implements AiProvider {
  readonly id = 'ollama-node-pool'
  readonly capabilities: ProviderCapabilities

  readonly #pool: NodePool
  readonly #fetch: FetchLike
  readonly #requestTimeoutMs: number
  readonly #modelCacheMs: number
  readonly #now: () => number
  readonly #log: (line: string) => void

  #modelCache: { at: number; models: ModelInfo[] } | undefined

  constructor(options: OllamaProviderOptions) {
    this.#pool = options.pool ?? new NodePool(options.registry)
    this.#fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 60_000
    this.#modelCacheMs = options.modelCacheMs ?? 5 * 60_000
    this.#now = options.now ?? Date.now
    this.#log = options.log ?? (() => {})

    this.capabilities = {
      nativeTools: false,
      streaming: true,
      maxContextTokens: options.maxContextTokens ?? 8192
    }
  }

  get pool(): NodePool {
    return this.#pool
  }

  async listModels(): Promise<ModelInfo[]> {
    const cached = this.#modelCache
    if (cached && this.#now() - cached.at < this.#modelCacheMs) return cached.models

    const fromRegistry: ModelInfo[] = this.#pool.models().map((id) => {
      const nodes = this.#pool.nodesFor(id)
      return {
        id,
        family: id.split(/[:/]/)[0] ?? id,
        nodeCount: nodes.length,
        tps: nodes.reduce((best, node) => Math.max(best, node.tps), 0)
      }
    })

    const live = new Set<string>()
    for (const node of this.#uniqueNodes().slice(0, 3)) {
      try {
        const response = await this.#fetch(`${node.url}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(this.#requestTimeoutMs)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = (await response.json()) as { models?: { name?: string }[] }
        for (const model of body.models ?? []) if (model.name) live.add(model.name)
        this.#pool.markHealthy(node.url)
      } catch (cause) {
        this.#pool.markUnhealthy(node.url)
        this.#log(redact(`[ollama] /api/tags failed for ${node.url}: ${String(cause)}`))
      }
    }

    const models = live.size
      ? [
          ...fromRegistry.filter((model) => live.has(model.id)),
          ...[...live]
            .filter((id) => !fromRegistry.some((model) => model.id === id))
            .map((id) => ({ id, family: id.split(/[:/]/)[0] ?? id, nodeCount: 0, tps: 0 }))
        ]
      : fromRegistry

    this.#modelCache = { at: this.#now(), models }
    return models
  }

  #uniqueNodes(): NodeEntry[] {
    const seen = new Map<string, NodeEntry>()
    for (const model of this.#pool.models()) {
      for (const node of this.#pool.candidates(model)) {
        if (!seen.has(node.url)) seen.set(node.url, node)
      }
    }
    return [...seen.values()].sort((a, b) => b.tps - a.tps)
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const candidates = this.#pool.candidates(request.model)

    if (candidates.length === 0) {
      yield {
        type: 'error',
        code: 'provider',
        message: redact(`No node in the pool hosts model "${request.model}"`),
        retryable: false
      }
      yield { type: 'done', finishReason: 'error' }
      return
    }

    let lastError: { code: 'network' | 'timeout' | 'provider'; message: string } | undefined

    for (const node of candidates) {
      if (signal.aborted) {
        yield { type: 'done', finishReason: 'cancelled' }
        return
      }

      let emittedDelta = false
      try {
        for await (const event of this.#streamFromNode(node, request, signal)) {
          if (event.type === 'delta') emittedDelta = true
          yield event
          if (event.type === 'done') return
        }
        return
      } catch (cause) {
        const { code, message } = classify(cause, signal)

        if (code === 'cancelled') {
          yield { type: 'done', finishReason: 'cancelled' }
          return
        }

        this.#pool.markUnhealthy(node.url)
        this.#log(redact(`[ollama] ${node.url} failed (${code}): ${message}`))
        lastError = { code, message }

        if (emittedDelta) {
          yield { type: 'error', code, message: redact(message), retryable: true }
          yield { type: 'done', finishReason: 'error' }
          return
        }
      }
    }

    yield {
      type: 'error',
      code: lastError?.code ?? 'network',
      message: redact(
        `All ${candidates.length} node(s) for "${request.model}" failed. ` +
          `Last error: ${lastError?.message ?? 'unknown'}`
      ),
      retryable: true
    }
    yield { type: 'done', finishReason: 'error' }
  }

  async *#streamFromNode(
    node: NodeEntry,
    request: ChatRequest,
    signal: AbortSignal
  ): AsyncIterable<StreamEvent> {
    const timeout = new AbortController()
    const timer = setTimeout(
      () => timeout.abort(new Error('request timeout')),
      this.#requestTimeoutMs
    )
    const composite = anySignal([signal, timeout.signal])

    try {
      const response = await this.#fetch(`${node.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: composite,
        body: JSON.stringify({
          model: request.model,
          messages: withToolDirective(request),
          stream: true,
          options: {
            ...(request.contextTokens !== undefined ? { num_ctx: request.contextTokens } : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {})
          }
        })
      })

      if (!response.ok) {
        throw new HttpError(response.status, `HTTP ${response.status} from ${node.url}`)
      }
      if (!response.body) {
        throw new Error(`Empty response body from ${node.url}`)
      }

      this.#pool.markHealthy(node.url)

      const scanner = new ToolCallScanner()
      let promptTokens = 0
      let completionTokens = 0
      let finish: 'stop' | 'length' = 'stop'
      let calls = 0

      for await (const line of ndjson(response.body, signal)) {
        if (line.error) throw new Error(line.error)

        const content = line.message?.content ?? ''
        if (content) {
          let scanned
          try {
            scanned = scanner.push(content)
          } catch (cause) {
            yield {
              type: 'error',
              code: 'provider',
              message: redact(cause instanceof ToolProtocolError ? cause.message : String(cause)),
              retryable: false
            }
            yield { type: 'done', finishReason: 'error' }
            return
          }
          if (scanned.text) yield { type: 'delta', text: scanned.text }
          for (const call of scanned.calls) {
            yield {
              type: 'tool_call',
              id: `${node.url}#${calls++}`,
              name: call.tool,
              args: call.args
            }
          }
        }

        if (line.done) {
          promptTokens = line.prompt_eval_count ?? 0
          completionTokens = line.eval_count ?? 0
          finish = line.done_reason === 'length' ? 'length' : 'stop'
          break
        }
      }

      if (signal.aborted) {
        yield { type: 'done', finishReason: 'cancelled' }
        return
      }

      try {
        const tail = scanner.flush()
        if (tail.text) yield { type: 'delta', text: tail.text }
      } catch (cause) {
        yield {
          type: 'error',
          code: 'provider',
          message: redact(cause instanceof Error ? cause.message : String(cause)),
          retryable: false
        }
        yield { type: 'done', finishReason: 'error' }
        return
      }

      yield { type: 'usage', promptTokens, completionTokens }
      yield { type: 'done', finishReason: finish }
    } finally {
      clearTimeout(timer)
    }
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

async function* ndjson(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<OllamaLine> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      if (signal.aborted) return
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) yield JSON.parse(line) as OllamaLine
        newline = buffer.indexOf('\n')
      }
    }

    const tail = buffer.trim()
    if (tail) yield JSON.parse(tail) as OllamaLine
  } finally {
    reader.cancel().catch(() => {})
  }
}

function withToolDirective(request: ChatRequest): ChatMessage[] {
  if (!request.tools?.length) return request.messages

  const directive: ChatMessage = {
    role: 'system',
    content: buildToolInstructions(request.tools)
  }
  const [first, ...rest] = request.messages

  if (first?.role === 'system') {
    return [{ role: 'system', content: `${first.content}\n\n${directive.content}` }, ...rest]
  }
  return [directive, ...request.messages]
}

function classify(
  cause: unknown,
  signal: AbortSignal
): { code: 'network' | 'timeout' | 'provider' | 'cancelled'; message: string } {
  if (signal.aborted) return { code: 'cancelled', message: 'cancelled by caller' }

  const message = cause instanceof Error ? cause.message : String(cause)
  const name = cause instanceof Error ? cause.name : ''

  if (name === 'TimeoutError' || name === 'AbortError' || /timeout/i.test(message)) {
    return { code: 'timeout', message }
  }
  if (cause instanceof HttpError) return { code: 'provider', message }
  return { code: 'network', message }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)

  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}
