import { describe, it, expect } from 'vitest'
import { migrate, WorkspaceDirectory, WorkspaceRepositories } from '@core/persistence'
import { migratedDb, openTestDb, realMigrations } from './helpers'

describe('migration 004 table rebuild', () => {
  it('declares that it needs foreign keys disabled', () => {
    const m = realMigrations().find((x) => x.version === 4)!
    expect(m.name).toBe('document_status')
    expect(m.foreignKeysOff).toBe(true)

    for (const other of realMigrations().filter((x) => x.version !== 4)) {
      expect(other.foreignKeysOff, `migration ${other.version}`).toBe(false)
    }
  })

  it('preserves existing chunks through the rebuild', () => {
    const db = openTestDb()
    migrate(
      db,
      realMigrations().filter((m) => m.version <= 3)
    )

    new WorkspaceDirectory(db).create('ws-a', 'A')

    db.prepare(
      `INSERT INTO documents (id, workspace_id, filename, mime, sha256, size_bytes, status, created_at)
       VALUES ('doc-1', 'ws-a', 'a.pdf', 'application/pdf', ?, 100, 'ready', '2026-01-01T00:00:00Z')`
    ).run('a'.repeat(64))
    const insertChunk = db.prepare(
      `INSERT INTO chunks (id, document_id, workspace_id, ordinal, text)
       VALUES (@id, 'doc-1', 'ws-a', @ordinal, @text)`
    )
    for (let i = 0; i < 5; i++) {
      insertChunk.run({ id: `c${i}`, ordinal: i, text: `chunk ${i} content` })
    }

    const repos = new WorkspaceRepositories(db, 'ws-a')

    const result = migrate(db, realMigrations())
    expect(result.applied).toContain(4)

    expect(repos.chunks.listByDocument('doc-1')).toHaveLength(5)
    expect(repos.documents.find('doc-1')).toBeDefined()

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('foreign_key_check')).toEqual([])

    expect(
      db.prepare(`SELECT count(*) AS n FROM chunks_fts WHERE chunks_fts MATCH 'content'`).get()
    ).toEqual({ n: 5 })
  })

  it('maps the old status values onto the new vocabulary', () => {
    const db = openTestDb()
    migrate(
      db,
      realMigrations().filter((m) => m.version <= 3)
    )
    new WorkspaceDirectory(db).create('ws-a', 'A')

    const insert = db.prepare(
      `INSERT INTO documents (id, workspace_id, filename, mime, sha256, size_bytes, status, created_at)
       VALUES (@id, 'ws-a', @id, 'text/plain', @id, 1, @status, '2026-01-01T00:00:00Z')`
    )
    insert.run({ id: 'a', status: 'ingesting' })
    insert.run({ id: 'b', status: 'error' })
    insert.run({ id: 'c', status: 'ready' })

    migrate(db, realMigrations())

    const rows = db
      .prepare('SELECT id, status, failure_reason FROM documents ORDER BY id')
      .all() as { id: string; status: string; failure_reason: string | null }[]

    expect(rows).toEqual([
      { id: 'a', status: 'parsing', failure_reason: null },
      { id: 'b', status: 'failed', failure_reason: 'unknown' },
      { id: 'c', status: 'ready', failure_reason: null }
    ])
  })

  it('enforces that a failed document always states a reason', () => {
    const db = migratedDb()
    new WorkspaceDirectory(db).create('ws-a', 'A')

    expect(() =>
      db
        .prepare(
          `INSERT INTO documents (id, workspace_id, filename, mime, sha256, size_bytes, status, created_at)
           VALUES ('x', 'ws-a', 'x', 'text/plain', 'x', 1, 'failed', '2026-01-01T00:00:00Z')`
        )
        .run()
    ).toThrow(/CHECK constraint/)

    expect(() =>
      db
        .prepare(
          `INSERT INTO documents (id, workspace_id, filename, mime, sha256, size_bytes, status, failure_reason, created_at)
           VALUES ('y', 'ws-a', 'y', 'text/plain', 'y', 1, 'ready', 'encrypted', '2026-01-01T00:00:00Z')`
        )
        .run()
    ).toThrow(/CHECK constraint/)
  })
})
