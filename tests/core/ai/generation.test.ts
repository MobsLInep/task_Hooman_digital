import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  CONTINUE_DIRECTIVE,
  GenerationBusyError,
  GenerationController,
  isPartial,
  MockProvider,
  type ChatRequest,
  type StreamEvent
} from '@core/ai'
import { WorkspaceDirectory, WorkspaceRepositories, type SqlDatabase } from '@core/persistence'
import { migratedDb } from '../persistence/helpers'

const request: ChatRequest = {
  model: 'mock-small',
  messages: [{ role: 'user', content: 'describe the river' }]
}

let db: Database.Database & SqlDatabase
let repos: WorkspaceRepositories
let ids: number

function setup(): void {
  db = migratedDb()
  new WorkspaceDirectory(db).create('ws-a', 'A')
  repos = new WorkspaceRepositories(db, 'ws-a')
  repos.conversations.create({ id: 'conv-1', title: 'One' })
  repos.conversations.create({ id: 'conv-2', title: 'Two' })
  ids = 0
}

function controllerWith(provider: MockProvider): GenerationController {
  return new GenerationController({
    provider,
    messages: repos.messages,
    newId: () => `msg-${++ids}`
  })
}

function assistantRows(
  conversationId = 'conv-1'
): ReturnType<typeof repos.messages.listByConversation> {
  return repos.messages.listByConversation(conversationId).filter((m) => m.role === 'assistant')
}

beforeEach(setup)

describe('MockProvider', () => {
  it('is deterministic for a given seed and request', async () => {
    const a = new MockProvider({ seed: 42 })
    const b = new MockProvider({ seed: 42 })
    const c = new MockProvider({ seed: 43 })

    expect(a.expectedText(request)).toBe(b.expectedText(request))
    expect(a.expectedText(request)).not.toBe(c.expectedText(request))

    const streamed = await collect(a.stream(request, new AbortController().signal))
    expect(text(streamed)).toBe(a.expectedText(request))
  })

  it('always terminates with exactly one done event', async () => {
    for (const failure of [
      undefined,
      'fail_at_chunk_3',
      'timeout',
      'malformed_tool_call'
    ] as const) {
      const provider = new MockProvider(failure ? { failure } : {})
      const events = await collect(provider.stream(request, new AbortController().signal))

      expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
      expect(events[events.length - 1]!.type).toBe('done')
    }
  })

  it('emits usage before done on success', async () => {
    const events = await collect(new MockProvider().stream(request, new AbortController().signal))
    const usage = events.find((e) => e.type === 'usage')

    expect(usage).toEqual({
      type: 'usage',
      promptTokens: expect.any(Number),
      completionTokens: expect.any(Number)
    })
    expect(events.findIndex((e) => e.type === 'usage')).toBeLessThan(
      events.findIndex((e) => e.type === 'done')
    )
  })

  it('emits a parsed tool_call through the prompt-based protocol', async () => {
    const provider = new MockProvider({ emitToolCall: true })
    const events = await collect(provider.stream(request, new AbortController().signal))
    const call = events.find((e) => e.type === 'tool_call')

    expect(call).toMatchObject({
      type: 'tool_call',
      name: 'document_search',
      args: { query: 'kestrel' }
    })

    expect(text(events)).not.toContain('tool_call')
  })

  it.each([
    ['fail_at_chunk_3', 'provider', true],
    ['timeout', 'timeout', true],
    ['malformed_tool_call', 'provider', false]
  ] as const)('injects failure mode %s as a typed error', async (failure, code, retryable) => {
    const provider = new MockProvider({ failure })
    const events = await collect(provider.stream(request, new AbortController().signal))
    const error = events.find((e) => e.type === 'error')

    expect(error).toMatchObject({ type: 'error', code, retryable })
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'error' })
  })
})

describe('rule 1 — cancel persists exactly one partial', () => {
  it('persists a single cancelled row holding the text produced so far', async () => {
    const provider = new MockProvider({ chunkDelayMs: 5, chunkCount: 20 })
    const controller = controllerWith(provider)

    let seen = ''
    const running = controller.start({
      conversationId: 'conv-1',
      request,
      handlers: {
        onDelta: (delta) => {
          seen += delta

          if (seen.length >= 3) controller.cancel('conv-1')
        }
      }
    })

    const outcome = await running
    expect(outcome.status).toBe('cancelled')

    const rows = assistantRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('cancelled')
    expect(rows[0]!.content).toBe(seen)
    expect(rows[0]!.content.length).toBeGreaterThan(0)

    expect(rows[0]!.content.length).toBeLessThan(provider.expectedText(request).length)

    expect(isPartial(rows[0]!)).toBe(true)

    expect(controller.isGenerating('conv-1')).toBe(false)
  })

  it('persists nothing when cancelled before any text arrived', async () => {
    const controller = controllerWith(new MockProvider({ chunkDelayMs: 50 }))
    const abort = new AbortController()

    const running = controller.start({ conversationId: 'conv-1', request })
    controller.cancel('conv-1')
    const outcome = await running

    expect(outcome.status).toBe('cancelled')
    expect(assistantRows()).toHaveLength(0)
    abort.abort()
  })
})

describe('rule 2 — retry writes a new row and never touches the old one', () => {
  it('produces two distinct rows linked by prevMessageId', async () => {
    const controller = controllerWith(new MockProvider({ seed: 1 }))

    const first = await controller.start({ conversationId: 'conv-1', request })
    expect(first.status).toBe('complete')
    const original = first.status === 'complete' ? first.message : undefined
    expect(original).toBeDefined()

    const before = { ...repos.messages.find(original!.id)! }

    const second = await controller.retry('conv-1', original!.id, request)
    expect(second.status).toBe('complete')
    const retried = second.status === 'complete' ? second.message : undefined

    const rows = assistantRows()
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)

    expect(retried!.prevMessageId).toBe(original!.id)
    expect(repos.messages.successors(original!.id).map((r) => r.id)).toEqual([retried!.id])

    expect(repos.messages.find(original!.id)).toEqual(before)
  })

  it('refuses to retry a message from another conversation', async () => {
    const controller = controllerWith(new MockProvider())
    const first = await controller.start({ conversationId: 'conv-1', request })
    const id = first.status === 'complete' ? first.message.id : ''

    await expect(controller.retry('conv-2', id, request)).rejects.toThrow(/does not belong/)
  })
})

describe('rule 3 — continue resends the partial plus a directive', () => {
  it('sends the partial as an assistant turn followed by the continue directive', async () => {
    const provider = new MockProvider({ chunkDelayMs: 5, chunkCount: 20 })
    const controller = controllerWith(provider)

    let seen = ''
    const cancelled = await controller.start({
      conversationId: 'conv-1',
      request,
      handlers: {
        onDelta: (delta) => {
          seen += delta
          if (seen.length >= 3) controller.cancel('conv-1')
        }
      }
    })
    const partial = cancelled.status === 'cancelled' ? cancelled.message! : undefined
    expect(isPartial(partial!)).toBe(true)

    let sent: ChatRequest | undefined
    const recording = new MockProvider({ chunkCount: 3 })
    const original = recording.stream.bind(recording)
    recording.stream = (req, signal) => {
      sent = req
      return original(req, signal)
    }

    const continuation = await new GenerationController({
      provider: recording,
      messages: repos.messages,
      newId: () => `msg-${++ids}`
    }).continue('conv-1', partial!.id, request)

    expect(continuation.status).toBe('complete')

    const turns = sent!.messages
    expect(turns[turns.length - 2]).toEqual({ role: 'assistant', content: partial!.content })
    expect(turns[turns.length - 1]).toEqual({ role: 'user', content: CONTINUE_DIRECTIVE })

    const rows = assistantRows()
    expect(rows).toHaveLength(2)
    const row = continuation.status === 'complete' ? continuation.message : undefined
    expect(row!.prevMessageId).toBe(partial!.id)
    expect(repos.messages.find(partial!.id)!.status).toBe('cancelled')
  })

  it('refuses to continue a message that is not a partial', async () => {
    const controller = controllerWith(new MockProvider())
    const done = await controller.start({ conversationId: 'conv-1', request })
    const id = done.status === 'complete' ? done.message.id : ''

    await expect(controller.continue('conv-1', id, request)).rejects.toThrow(/not a partial/)
  })
})

describe('rule 4 — a generation is owned by conversationId, not the view', () => {
  it('cancelling one conversation leaves another running', async () => {
    const controller = controllerWith(new MockProvider({ chunkDelayMs: 5, chunkCount: 12 }))

    const one = controller.start({ conversationId: 'conv-1', request })
    const two = controller.start({ conversationId: 'conv-2', request })

    expect(new Set(controller.activeConversationIds())).toEqual(new Set(['conv-1', 'conv-2']))

    controller.cancel('conv-1')

    const [first, second] = await Promise.all([one, two])
    expect(first.status).toBe('cancelled')
    expect(second.status).toBe('complete')

    expect(assistantRows('conv-2')).toHaveLength(1)
    expect(assistantRows('conv-2')[0]!.status).toBe('complete')
  })

  it('cancelling an unknown conversation is a no-op, not a stray abort', async () => {
    const controller = controllerWith(new MockProvider({ chunkDelayMs: 5, chunkCount: 10 }))
    const running = controller.start({ conversationId: 'conv-1', request })

    expect(controller.cancel('conv-2')).toBe(false)
    expect(controller.cancel('does-not-exist')).toBe(false)

    expect((await running).status).toBe('complete')
  })

  it('deltas keep arriving with their conversationId after a notional view switch', async () => {
    const controller = controllerWith(new MockProvider({ chunkDelayMs: 1, chunkCount: 5 }))
    const tagged: string[] = []

    const outcome = await controller.start({
      conversationId: 'conv-1',
      request,
      handlers: { onDelta: (_text, conversationId) => tagged.push(conversationId) }
    })

    expect(outcome.status).toBe('complete')
    expect(tagged.length).toBeGreaterThan(0)

    expect(new Set(tagged)).toEqual(new Set(['conv-1']))
  })

  it('refuses a second concurrent generation in the same conversation', async () => {
    const controller = controllerWith(new MockProvider({ chunkDelayMs: 5 }))
    const running = controller.start({ conversationId: 'conv-1', request })

    await expect(controller.start({ conversationId: 'conv-1', request })).rejects.toThrow(
      GenerationBusyError
    )
    await running
  })
})

describe('provider errors do not persist a phantom assistant message', () => {
  it.each(['fail_at_chunk_3', 'timeout', 'malformed_tool_call'] as const)(
    'surfaces %s as a typed error and writes no row',
    async (failure) => {
      const controller = controllerWith(new MockProvider({ failure }))
      const events: StreamEvent[] = []

      const outcome = await controller.start({
        conversationId: 'conv-1',
        request,
        handlers: { onEvent: (event) => events.push(event) }
      })

      expect(outcome.status).toBe('error')
      if (outcome.status === 'error') {
        expect(outcome.code).toBe(failure === 'timeout' ? 'timeout' : 'provider')
        expect(outcome.message).toBeTruthy()
        expect(outcome.retryable).toBe(failure !== 'malformed_tool_call')
      }

      expect(events.filter((e) => e.type === 'error')).toHaveLength(1)

      expect(assistantRows()).toHaveLength(0)
      expect(repos.messages.listByConversation('conv-1')).toHaveLength(0)
      expect(controller.isGenerating('conv-1')).toBe(false)
    }
  )

  it('leaves the conversation usable for a subsequent successful generation', async () => {
    const failing = controllerWith(new MockProvider({ failure: 'fail_at_chunk_3' }))
    expect((await failing.start({ conversationId: 'conv-1', request })).status).toBe('error')

    const working = controllerWith(new MockProvider())
    const outcome = await working.start({ conversationId: 'conv-1', request })

    expect(outcome.status).toBe('complete')
    expect(assistantRows()).toHaveLength(1)
    expect(assistantRows()[0]!.prevMessageId).toBeNull()
  })
})

async function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

function text(events: readonly StreamEvent[]): string {
  return events
    .filter((e) => e.type === 'delta')
    .map((e) => e.text)
    .join('')
}
