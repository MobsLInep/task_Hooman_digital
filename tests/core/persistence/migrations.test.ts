import { describe, it, expect } from 'vitest'
import {
  appliedMigrations,
  loadMigrations,
  migrate,
  MigrationError,
  type Migration,
  type SqlDatabase
} from '@core/persistence'
import { MIGRATIONS_DIR, openTestDb, realMigrations } from './helpers'

const ALL_VERSIONS = realMigrations().map((m) => m.version)
const HEAD = ALL_VERSIONS[ALL_VERSIONS.length - 1]!

describe('loadMigrations', () => {
  it('reads the numbered .sql files in version order', () => {
    const migrations = loadMigrations(MIGRATIONS_DIR)

    expect(migrations.map((m) => m.version)).toEqual(
      Array.from({ length: migrations.length }, (_, i) => i + 1)
    )
    expect(migrations[0]!.name).toBe('initial_schema')
    expect(migrations[1]!.name).toBe('index_messages_conversation')
    expect(migrations.every((m) => /^[0-9a-f]{64}$/.test(m.checksum))).toBe(true)
  })
})

describe('migrate', () => {
  it('applies every migration to a fresh database', () => {
    const db = openTestDb()
    const result = migrate(db, realMigrations())

    expect(result.applied).toEqual(ALL_VERSIONS)
    expect(result.version).toBe(HEAD)
    expect(appliedMigrations(db).map((m) => m.version)).toEqual(ALL_VERSIONS)
  })

  it('is idempotent — a second run applies nothing', () => {
    const db = openTestDb()
    migrate(db, realMigrations())

    const second = migrate(db, realMigrations())
    expect(second.applied).toEqual([])
    expect(second.version).toBe(HEAD)

    expect(appliedMigrations(db).map((m) => m.version)).toEqual(ALL_VERSIONS)

    const third = migrate(db, realMigrations())
    expect(third.applied).toEqual([])
  })

  it('applies 002 to a database already migrated to 001', () => {
    const all = realMigrations()
    const db = openTestDb()

    const first = migrate(db, [all[0]!])
    expect(first.applied).toEqual([1])
    expect(indexExists(db, 'idx_messages_conversation_created')).toBe(false)

    const second = migrate(db, all.slice(0, 2))
    expect(second.applied).toEqual([2])
    expect(indexExists(db, 'idx_messages_conversation_created')).toBe(true)

    expect(appliedMigrations(db).map((m) => m.version)).toEqual([1, 2])

    expect(migrate(db, all).applied).toEqual(ALL_VERSIONS.slice(2))
  })

  it('rejects a database migrated by a newer build', () => {
    const db = openTestDb()
    migrate(db, realMigrations())

    expect(() => migrate(db, [realMigrations()[0]!])).toThrow(MigrationError)
    expect(() => migrate(db, [realMigrations()[0]!])).toThrow(/forward-only/)
  })

  it('rejects an applied migration whose file has been edited', () => {
    const db = openTestDb()
    migrate(db, realMigrations())

    const tampered = realMigrations()
    const edited: Migration = { ...tampered[1]!, checksum: 'f'.repeat(64) }

    expect(() => migrate(db, [tampered[0]!, edited, ...tampered.slice(2)])).toThrow(/immutable/)
  })

  it('rolls back a failing migration entirely', () => {
    const db = openTestDb()
    const broken: Migration = {
      version: HEAD + 1,
      name: 'broken',
      sql: 'CREATE TABLE ok_so_far (id TEXT); THIS IS NOT SQL;',
      checksum: 'a'.repeat(64),
      foreignKeysOff: false
    }

    expect(() => migrate(db, [...realMigrations(), broken])).toThrow(MigrationError)

    expect(tableExists(db, 'ok_so_far')).toBe(false)
    expect(appliedMigrations(db).map((m) => m.version)).toEqual(ALL_VERSIONS)

    expect(migrate(db, realMigrations()).applied).toEqual([])
  })
})

describe('schema', () => {
  it('enables foreign key enforcement', () => {
    const db = openTestDb()

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('declares workspace_id NOT NULL with ON DELETE CASCADE on every scoped table', () => {
    const db = openTestDb()
    migrate(db, realMigrations())

    const scoped = [
      'conversations',
      'messages',
      'documents',
      'chunks',
      'notes',
      'tasks',
      'activity',
      'providers'
    ]

    for (const table of scoped) {
      const columns = db.pragma(`table_info(${table})`) as { name: string; notnull: number }[]
      const workspaceId = columns.find((c) => c.name === 'workspace_id')
      expect(workspaceId, `${table}.workspace_id exists`).toBeDefined()
      expect(workspaceId!.notnull, `${table}.workspace_id NOT NULL`).toBe(1)

      const keys = db.pragma(`foreign_key_list(${table})`) as {
        table: string
        from: string
        on_delete: string
      }[]
      const fk = keys.find((k) => k.from === 'workspace_id')
      expect(fk, `${table}.workspace_id has an FK`).toBeDefined()
      expect(fk!.table).toBe('workspaces')
      expect(fk!.on_delete, `${table}.workspace_id ON DELETE`).toBe('CASCADE')
    }
  })
})

function indexExists(db: SqlDatabase, name: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = @name`)
      .get({ name }) !== undefined
  )
}

function tableExists(db: SqlDatabase, name: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = @name`)
      .get({ name }) !== undefined
  )
}
