import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { TaskWorker, type TaskHandler } from '@core/tasks'
import { WorkspaceDirectory, WorkspaceRepositories, type SqlDatabase } from '@core/persistence'
import { migratedDb } from '../persistence/helpers'

let db: Database.Database & SqlDatabase
let repos: WorkspaceRepositories
let clock: Date

const at = (iso: string): Date => new Date(iso)

function worker(handlers: TaskHandler[], options: { maxAttempts?: number } = {}): TaskWorker {
  return new TaskWorker({
    tasks: repos.tasks,
    workspaceId: 'ws-a',
    handlers,
    leaseSeconds: 60,
    maxAttempts: options.maxAttempts ?? 3,
    now: () => clock
  })
}

const ok: TaskHandler = {
  type: 'summarize',
  handle: async (payload) => ({ summary: `summary of ${(payload as { of?: string }).of ?? '?'}` })
}

beforeEach(() => {
  db = migratedDb()
  new WorkspaceDirectory(db).create('ws-a', 'A')
  repos = new WorkspaceRepositories(db, 'ws-a')
  clock = at('2026-08-19T10:00:00.000Z')
})

describe('the happy path', () => {
  it('moves queued -> running -> done and keeps the result', async () => {
    repos.tasks.enqueue({
      id: 't1',
      type: 'summarize',
      paramsJson: JSON.stringify({ of: 'doc-1' })
    })
    expect(repos.tasks.find('t1')!.status).toBe('queued')

    const outcome = await worker([ok]).runOnce()

    expect(outcome.status).toBe('done')
    const row = repos.tasks.find('t1')!
    expect(row.status).toBe('done')
    expect(row.attempts).toBe(1)
    expect(row.leaseExpiresAt).toBeNull()
    expect(JSON.parse(row.resultJson!)).toEqual({ summary: 'summary of doc-1' })
  })

  it('reports idle when the queue is empty', async () => {
    expect((await worker([ok]).runOnce()).status).toBe('idle')
  })

  it('drains a queue in enqueue order', async () => {
    for (const id of ['t1', 't2', 't3']) {
      repos.tasks.enqueue({ id, type: 'summarize', paramsJson: JSON.stringify({ of: id }) })
    }

    const outcomes = await worker([ok]).drain()

    expect(outcomes.map((o) => o.status)).toEqual(['done', 'done', 'done'])
    expect(repos.tasks.listByStatus('done').map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(repos.tasks.listByStatus('queued')).toHaveLength(0)
  })
})

describe('recovery from a worker that died holding the lease', () => {
  it('reclaims a running task once its lease expires, and only then', async () => {
    repos.tasks.enqueue({ id: 't1', type: 'summarize', paramsJson: '{}' })

    const claimed = repos.tasks.claim(60, clock)!
    expect(claimed.id).toBe('t1')
    expect(repos.tasks.find('t1')!.status).toBe('running')
    expect(repos.tasks.find('t1')!.attempts).toBe(1)

    clock = at('2026-08-19T10:00:30.000Z')
    expect((await worker([ok]).runOnce()).status).toBe('idle')
    expect(repos.tasks.find('t1')!.status).toBe('running')

    clock = at('2026-08-19T10:01:01.000Z')
    const outcome = await worker([ok]).runOnce()

    expect(outcome.status).toBe('done')
    const row = repos.tasks.find('t1')!
    expect(row.status).toBe('done')

    expect(row.attempts).toBe(2)
  })

  it('resumes from the checkpoint the dead worker left behind', async () => {
    repos.tasks.enqueue({ id: 't1', type: 'summarize', paramsJson: '{}' })

    repos.tasks.claim(60, clock)
    repos.tasks.checkpoint('t1', JSON.stringify({ pagesDone: 42 }))

    clock = at('2026-08-19T10:01:01.000Z')

    let seenPartial: unknown
    const resuming: TaskHandler = {
      type: 'summarize',
      handle: async (_payload, ctx) => {
        seenPartial = ctx.partial
        return { resumedFrom: ctx.partial, attempt: ctx.attempt }
      }
    }

    const outcome = await worker([resuming]).runOnce()

    expect(outcome.status).toBe('done')

    expect(seenPartial).toEqual({ pagesDone: 42 })
    expect(JSON.parse(repos.tasks.find('t1')!.resultJson!)).toEqual({
      resumedFrom: { pagesDone: 42 },
      attempt: 2
    })
  })
})

describe('retry and exhaustion', () => {
  const alwaysFails: TaskHandler = {
    type: 'summarize',
    handle: async () => {
      throw new Error('node unreachable')
    }
  }

  it('requeues a failure and abandons it after maxAttempts', async () => {
    repos.tasks.enqueue({ id: 't1', type: 'summarize', paramsJson: '{}' })
    const w = worker([alwaysFails], { maxAttempts: 3 })

    for (const attempt of [1, 2]) {
      const outcome = await w.runOnce()
      expect(outcome.status, `attempt ${attempt}`).toBe('retry')

      const row = repos.tasks.find('t1')!
      expect(row.status).toBe('queued')
      expect(row.attempts).toBe(attempt)
      expect(row.error).toBe('node unreachable')

      expect(row.leaseExpiresAt).toBeNull()
    }

    const final = await w.runOnce()
    expect(final.status).toBe('failed')

    const row = repos.tasks.find('t1')!
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(3)
    expect(row.error).toBe('node unreachable')

    expect((await w.runOnce()).status).toBe('idle')
  })

  it('succeeds on a retry after a transient failure', async () => {
    repos.tasks.enqueue({ id: 't1', type: 'summarize', paramsJson: '{}' })

    let calls = 0
    const flaky: TaskHandler = {
      type: 'summarize',
      handle: async () => {
        calls++
        if (calls === 1) throw new Error('transient')
        return { ok: true, onAttempt: calls }
      }
    }

    const w = worker([flaky])
    expect((await w.runOnce()).status).toBe('retry')
    expect((await w.runOnce()).status).toBe('done')

    const row = repos.tasks.find('t1')!
    expect(row.status).toBe('done')
    expect(row.attempts).toBe(2)

    expect(row.error).toBeNull()
  })

  it('fails an unknown task type immediately rather than retrying', async () => {
    repos.tasks.enqueue({ id: 't1', type: 'no_such_type', paramsJson: '{}' })

    const outcome = await worker([ok]).runOnce()

    expect(outcome.status).toBe('failed')
    const row = repos.tasks.find('t1')!
    expect(row.status).toBe('failed')

    expect(row.attempts).toBe(1)
    expect(row.error).toMatch(/No handler registered/)
  })
})

describe('workspace isolation', () => {
  it('never claims a task belonging to another workspace', async () => {
    new WorkspaceDirectory(db).create('ws-b', 'B')
    const other = new WorkspaceRepositories(db, 'ws-b')
    other.tasks.enqueue({ id: 'task-b', type: 'summarize', paramsJson: '{}' })

    expect((await worker([ok]).runOnce()).status).toBe('idle')
    expect(other.tasks.find('task-b')!.status).toBe('queued')

    const b = new TaskWorker({
      tasks: other.tasks,
      workspaceId: 'ws-b',
      handlers: [ok],
      now: () => clock
    })
    expect((await b.runOnce()).status).toBe('done')
  })
})
