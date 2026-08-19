import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { GenerationController, MockProvider, type ChatRequest } from '@core/ai'
import { WorkspaceDirectory, WorkspaceRepositories, type SqlDatabase } from '@core/persistence'
import { GenerationHub, type HubEvent } from '../../src/main/generationHub'
import { migratedDb } from '../core/persistence/helpers'

const request: ChatRequest = {
  model: 'mock-small',
  messages: [{ role: 'user', content: 'describe the river' }]
}

let db: Database.Database & SqlDatabase
let events: HubEvent[]
let ids: number

function makeHub(provider = new MockProvider({ chunkDelayMs: 4, chunkCount: 40 })): GenerationHub {
  return new GenerationHub({
    broadcast: (event) => events.push(event),
    controllerFor: (workspaceId) =>
      new GenerationController({
        provider,
        messages: new WorkspaceRepositories(db, workspaceId).messages,
        newId: () => `msg-${++ids}`
      })
  })
}

beforeEach(() => {
  db = migratedDb()
  const directory = new WorkspaceDirectory(db)
  directory.create('ws-a', 'A')
  directory.create('ws-b', 'B')

  const a = new WorkspaceRepositories(db, 'ws-a')
  a.conversations.create({ id: 'conv-1', title: 'One' })
  a.conversations.create({ id: 'conv-2', title: 'Two' })
  new WorkspaceRepositories(db, 'ws-b').conversations.create({ id: 'conv-b', title: 'B one' })

  events = []
  ids = 0
})

describe('a stream survives the view switching away', () => {
  it('accumulates text in main while nobody is watching', async () => {
    const hub = makeHub()
    const running = hub.start('ws-a', 'conv-1', request)

    await tick(30)
    const atSwitchAway = hub.snapshot('conv-1')
    expect(atSwitchAway.generating).toBe(true)
    expect(atSwitchAway.text.length).toBeGreaterThan(0)

    await tick(60)

    const onReturn = hub.snapshot('conv-1')
    expect(onReturn.text.length).toBeGreaterThan(atSwitchAway.text.length)
    expect(onReturn.text.startsWith(atSwitchAway.text)).toBe(true)

    const outcome = await running
    expect(outcome.status).toBe('complete')

    const persisted = new WorkspaceRepositories(db, 'ws-a').messages
      .listByConversation('conv-1')
      .filter((m) => m.role === 'assistant')
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.content.startsWith(atSwitchAway.text)).toBe(true)
  })

  it('keeps streaming a conversation in ANOTHER workspace', async () => {
    const hub = makeHub()
    const running = hub.start('ws-b', 'conv-b', request)

    await tick(30)

    expect(hub.isGenerating('conv-b')).toBe(true)
    expect(hub.activeConversationIds()).toEqual(['conv-b'])

    expect((await running).status).toBe('complete')
  })

  it('runs two conversations at once and keeps their text separate', async () => {
    const hub = makeHub()
    const one = hub.start('ws-a', 'conv-1', request)
    const two = hub.start('ws-a', 'conv-2', {
      ...request,
      messages: [{ role: 'user', content: 'a different question entirely' }]
    })

    await tick(40)
    expect(new Set(hub.activeConversationIds())).toEqual(new Set(['conv-1', 'conv-2']))

    const first = hub.snapshot('conv-1').text
    const second = hub.snapshot('conv-2').text
    expect(first.length).toBeGreaterThan(0)
    expect(second.length).toBeGreaterThan(0)

    expect(first).not.toBe(second)

    await Promise.all([one, two])
  })

  it('reports an empty snapshot for a conversation that never generated', () => {
    const hub = makeHub()
    expect(hub.snapshot('conv-2')).toMatchObject({
      conversationId: 'conv-2',
      generating: false,
      text: '',
      toolCalls: []
    })
  })
})

describe('cancel is addressed by conversation', () => {
  it('cancels only the named conversation', async () => {
    const hub = makeHub()
    const one = hub.start('ws-a', 'conv-1', request)
    const two = hub.start('ws-a', 'conv-2', request)

    await tick(30)
    expect(hub.cancel('conv-1')).toBe(true)

    const [first, second] = await Promise.all([one, two])
    expect(first.status).toBe('cancelled')
    expect(second.status).toBe('complete')

    const rows = new WorkspaceRepositories(db, 'ws-a').messages
      .listByConversation('conv-1')
      .filter((m) => m.role === 'assistant')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('cancelled')
    expect(rows[0]!.content.length).toBeGreaterThan(0)
  })

  it('cancelling an unknown conversation is a no-op', async () => {
    const hub = makeHub()
    expect(hub.cancel('nope')).toBe(false)

    const running = hub.start('ws-a', 'conv-1', request)
    await tick(20)
    expect(hub.cancel('conv-2')).toBe(false)
    expect((await running).status).toBe('complete')
  })
})

describe('events', () => {
  it('broadcasts state, deltas and a settled event, all carrying the conversationId', async () => {
    const hub = makeHub()
    await hub.start('ws-a', 'conv-1', request)

    expect(events.every((event) => event.conversationId === 'conv-1')).toBe(true)

    const kinds = events.map((event) => event.type)
    expect(kinds[0]).toBe('state')
    expect(kinds).toContain('delta')
    expect(kinds[kinds.length - 1]).toBe('settled')

    const first = events[0]
    expect(first).toMatchObject({ type: 'state', generating: true })

    const settled = events[events.length - 1]
    expect(settled).toMatchObject({ type: 'settled', outcome: 'complete' })
  })

  it('always releases the generating state, even when start throws', async () => {
    const hub = makeHub()
    const running = hub.start('ws-a', 'conv-1', request)

    await expect(hub.start('ws-a', 'conv-1', request)).rejects.toThrow()

    const stateEvents = events.filter((event) => event.type === 'state')
    expect(stateEvents[stateEvents.length - 1]).toMatchObject({ generating: false })

    await running.catch(() => {})
  })

  it('keeps the last context report per conversation for the inspector', () => {
    const hub = makeHub()
    const report = { total: 42 } as never

    expect(hub.report('conv-1')).toBeUndefined()
    hub.rememberReport('conv-1', report)
    expect(hub.report('conv-1')).toBe(report)
    expect(hub.report('conv-2')).toBeUndefined()
  })
})

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
