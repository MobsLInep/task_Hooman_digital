import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_UNHEALTHY_MS,
  loadNodeRegistry,
  NodePool,
  OllamaNodePoolProvider,
  parseNodeRegistry,
  type NodeRegistry,
  type StreamEvent
} from '@core/ai'

const registry: NodeRegistry = {
  nodes: {
    'llama3.2:3b': [
      { url: 'http://slow.example:11434', tps: 8 },
      { url: 'http://fast.example:11434', tps: 75 },
      { url: 'http://middling.example:11434', tps: 14 }
    ]
  }
}

function ndjsonResponse(lines: unknown[], chunkSplit = false): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const text = lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
      if (chunkSplit) {
        const cut = Math.floor(text.length / 2)
        controller.enqueue(encoder.encode(text.slice(0, cut)))
        controller.enqueue(encoder.encode(text.slice(cut)))
      } else {
        controller.enqueue(encoder.encode(text))
      }
      controller.close()
    }
  })
  return new Response(body, { status: 200 })
}

const okStream = (text: string[], extra: Record<string, unknown> = {}): unknown[] => [
  ...text.map((content) => ({ message: { role: 'assistant', content }, done: false })),
  { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', ...extra }
]

async function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

const deltas = (events: StreamEvent[]): string =>
  events
    .filter((e) => e.type === 'delta')
    .map((e) => e.text)
    .join('')

describe('NodePool', () => {
  it('orders candidates by advertised throughput, fastest first', () => {
    const pool = new NodePool(registry)
    expect(pool.candidates('llama3.2:3b').map((n) => n.url)).toEqual([
      'http://fast.example:11434',
      'http://middling.example:11434',
      'http://slow.example:11434'
    ])
  })

  it('marks a failing node unhealthy for 60s, then restores it', () => {
    let clock = 1_000_000
    const pool = new NodePool(registry, { now: () => clock })

    pool.markUnhealthy('http://fast.example:11434')
    expect(pool.isHealthy('http://fast.example:11434')).toBe(false)
    expect(pool.candidates('llama3.2:3b')[0]!.url).toBe('http://middling.example:11434')

    clock += DEFAULT_UNHEALTHY_MS - 1
    expect(pool.isHealthy('http://fast.example:11434')).toBe(false)

    clock += 1
    expect(pool.isHealthy('http://fast.example:11434')).toBe(true)
    expect(pool.candidates('llama3.2:3b')[0]!.url).toBe('http://fast.example:11434')
  })

  it('still offers nodes when every one of them is cooling off', () => {
    let clock = 0
    const pool = new NodePool(registry, { now: () => clock })
    for (const node of registry.nodes['llama3.2:3b']!) pool.markUnhealthy(node.url)

    const candidates = pool.candidates('llama3.2:3b')
    expect(candidates).toHaveLength(3)
    clock += 10
    expect(pool.candidates('llama3.2:3b')).toHaveLength(3)
  })

  it('validates and loads the committed registry', () => {
    const path = resolve(__dirname, '../../../resources/ollama-nodes.json')
    const loaded = loadNodeRegistry(path)

    expect(Object.keys(loaded.nodes).length).toBeGreaterThan(0)
    for (const entries of Object.values(loaded.nodes)) {
      for (const entry of entries) {
        expect(entry.url).toMatch(/^https?:\/\//)
        expect(entry.tps).toBeGreaterThanOrEqual(0)
      }
    }

    expect(loaded.nodes['llama3.2:3b']).toBeDefined()
  })

  it('rejects a malformed registry rather than half-loading it', () => {
    expect(() => parseNodeRegistry({ nodes: { m: [{ url: 'not-a-url', tps: 1 }] } })).toThrow()
    expect(() => parseNodeRegistry({ nodes: { m: [{ url: 'http://n', tps: -5 }] } })).toThrow()
  })
})

describe('OllamaNodePoolProvider', () => {
  it('reports nativeTools false — a community node version is unknowable', () => {
    const provider = new OllamaNodePoolProvider({ registry })
    expect(provider.capabilities).toMatchObject({ nativeTools: false, streaming: true })
  })

  it('POSTs /api/chat with stream:true and a real messages array', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = []
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async (url, init) => {
        seen.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return ndjsonResponse(okStream(['hel', 'lo']))
      }
    })

    await collect(
      provider.stream(
        {
          model: 'llama3.2:3b',
          messages: [
            { role: 'system', content: 'be terse' },
            { role: 'user', content: 'hi' }
          ],
          temperature: 0.4,
          maxTokens: 128,
          contextTokens: 4096
        },
        new AbortController().signal
      )
    )

    expect(seen).toHaveLength(1)

    expect(seen[0]!.url).toBe('http://fast.example:11434/api/chat')
    expect(seen[0]!.body).toMatchObject({
      model: 'llama3.2:3b',
      stream: true,
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' }
      ],
      options: { num_ctx: 4096, temperature: 0.4, num_predict: 128 }
    })
  })

  it('parses NDJSON deltas and emits usage from the done line', async () => {
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async () =>
        ndjsonResponse(okStream(['the ', 'kestrel'], { prompt_eval_count: 17, eval_count: 42 }))
    })

    const events = await collect(
      provider.stream(
        { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'go' }] },
        new AbortController().signal
      )
    )

    expect(deltas(events)).toBe('the kestrel')
    expect(events.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      promptTokens: 17,
      completionTokens: 42
    })
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'stop' })
  })

  it('reassembles NDJSON lines split across network chunks', async () => {
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async () => ndjsonResponse(okStream(['alpha ', 'beta ', 'gamma']), true)
    })

    const events = await collect(
      provider.stream(
        { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'go' }] },
        new AbortController().signal
      )
    )
    expect(deltas(events)).toBe('alpha beta gamma')
  })

  it('maps done_reason length to finishReason length', async () => {
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async () =>
        ndjsonResponse([
          { message: { content: 'trunc' }, done: false },
          { message: { content: '' }, done: true, done_reason: 'length' }
        ])
    })

    const events = await collect(
      provider.stream(
        { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'go' }] },
        new AbortController().signal
      )
    )
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'length' })
  })

  it('marks a failing node unhealthy and falls through to the next', async () => {
    const tried: string[] = []
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async (url) => {
        tried.push(new URL(url).host)
        if (url.includes('fast')) throw new TypeError('fetch failed')
        if (url.includes('middling')) return new Response('nope', { status: 503 })
        return ndjsonResponse(okStream(['recovered']))
      }
    })

    const events = await collect(
      provider.stream(
        { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'go' }] },
        new AbortController().signal
      )
    )

    expect(tried).toEqual(['fast.example:11434', 'middling.example:11434', 'slow.example:11434'])
    expect(deltas(events)).toBe('recovered')
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'stop' })

    expect(provider.pool.isHealthy('http://fast.example:11434')).toBe(false)
    expect(provider.pool.isHealthy('http://middling.example:11434')).toBe(false)
    expect(provider.pool.isHealthy('http://slow.example:11434')).toBe(true)
  })

  it('does NOT fail over once text has already been emitted', async () => {
    let calls = 0
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async () => {
        calls++
        const encoder = new TextEncoder()
        let stage = 0

        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (stage++ === 0) {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ message: { content: 'half a sen' }, done: false }) + '\n'
                  )
                )
              } else {
                controller.error(new Error('connection reset'))
              }
            }
          }),
          { status: 200 }
        )
      }
    })

    const events = await collect(
      provider.stream(
        { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'go' }] },
        new AbortController().signal
      )
    )

    expect(calls).toBe(1)
    expect(deltas(events)).toBe('half a sen')
    expect(events.find((e) => e.type === 'error')).toMatchObject({ type: 'error', retryable: true })
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'error' })
  })

  it('reports a typed error when every node fails', async () => {
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async () => {
        throw new TypeError('fetch failed')
      }
    })

    const events = await collect(
      provider.stream(
        { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'go' }] },
        new AbortController().signal
      )
    )

    expect(events.find((e) => e.type === 'error')).toMatchObject({
      type: 'error',
      code: 'network',
      retryable: true
    })
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'error' })
  })

  it('reports a typed error when no node hosts the model', async () => {
    const provider = new OllamaNodePoolProvider({ registry })
    const events = await collect(
      provider.stream(
        { model: 'not-hosted:70b', messages: [{ role: 'user', content: 'go' }] },
        new AbortController().signal
      )
    )

    expect(events).toEqual([
      {
        type: 'error',
        code: 'provider',
        message: expect.stringContaining('not-hosted:70b'),
        retryable: false
      },
      { type: 'done', finishReason: 'error' }
    ])
  })

  it('cancels via AbortSignal and reports cancellation, not failure', async () => {
    const abort = new AbortController()
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async (_url, init) => {
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({ message: { content: 'begin' }, done: false }) + '\n'
                )
              )

              init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
            }
          }),
          { status: 200 }
        )
      }
    })

    const events: StreamEvent[] = []
    for await (const event of provider.stream(
      { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'go' }] },
      abort.signal
    )) {
      events.push(event)
      if (event.type === 'delta') abort.abort()
    }

    expect(deltas(events)).toBe('begin')
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'cancelled' })

    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(provider.pool.isHealthy('http://fast.example:11434')).toBe(true)
  })

  it('surfaces an error line from the node as a provider error', async () => {
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async () => ndjsonResponse([{ error: 'model requires more system memory' }])
    })

    const events = await collect(
      provider.stream(
        { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'go' }] },
        new AbortController().signal
      )
    )
    expect(events.find((e) => e.type === 'error')).toBeDefined()
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'error' })
  })

  it('injects the prompt-based tool directive instead of a native tools field', async () => {
    let body: Record<string, unknown> = {}
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async (_url, init) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>
        return ndjsonResponse(okStream(['ok']))
      }
    })

    await collect(
      provider.stream(
        {
          model: 'llama3.2:3b',
          messages: [{ role: 'user', content: 'find the falcon' }],
          tools: [{ name: 'search', description: 'search docs', parameters: { type: 'object' } }]
        },
        new AbortController().signal
      )
    )

    expect(body['tools']).toBeUndefined()
    const messages = body['messages'] as { role: string; content: string }[]
    expect(messages[0]!.role).toBe('system')

    expect(messages[0]!.content).toContain('"tool"')
    expect(messages[0]!.content).toContain('"args"')
    expect(messages[0]!.content).toContain('search')

    expect(messages[0]!.content).toContain('"type":"object"')
  })

  it('enumerates models at runtime and caches the result', async () => {
    let tagCalls = 0
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async (url) => {
        if (url.endsWith('/api/tags')) {
          tagCalls++
          return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), {
            status: 200
          })
        }
        throw new Error('unexpected')
      }
    })

    const first = await provider.listModels()
    expect(first.map((m) => m.id)).toContain('llama3.2:3b')
    expect(first[0]).toMatchObject({ family: 'llama3.2', nodeCount: 3 })

    const callsAfterFirst = tagCalls
    await provider.listModels()
    expect(tagCalls).toBe(callsAfterFirst)
  })

  it('falls back to the committed registry when no node answers', async () => {
    const provider = new OllamaNodePoolProvider({
      registry,
      fetch: async () => {
        throw new TypeError('fetch failed')
      }
    })

    expect((await provider.listModels()).map((m) => m.id)).toEqual(['llama3.2:3b'])
  })
})
