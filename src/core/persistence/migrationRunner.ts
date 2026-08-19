import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SqlDatabase } from './database'

const FILENAME = /^(\d{3,})_([a-z0-9_]+)\.sql$/

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
  readonly checksum: string
  readonly foreignKeysOff: boolean
}

export interface AppliedMigration {
  readonly version: number
  readonly name: string
  readonly checksum: string
  readonly appliedAt: string
}

export class MigrationError extends Error {}

function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}

export function loadMigrations(dir: string): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = FILENAME.exec(file)
      if (!match) {
        throw new MigrationError(
          `Migration filename "${file}" must look like 001_snake_case_name.sql`
        )
      }
      const sql = readFileSync(join(dir, file), 'utf8')
      return {
        version: Number(match[1]),
        name: match[2]!,
        sql,
        checksum: checksum(sql),
        foreignKeysOff: /^\s*--\s*@foreign-keys-off\s*$/m.test(sql)
      }
    })
    .sort((a, b) => a.version - b.version)

  migrations.forEach((migration, i) => {
    const previous = migrations[i - 1]
    if (previous && previous.version === migration.version) {
      throw new MigrationError(
        `Duplicate migration version ${migration.version}: "${previous.name}" and "${migration.name}"`
      )
    }
  })

  return migrations
}

function ensureVersionTable(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
}

export function appliedMigrations(db: SqlDatabase): AppliedMigration[] {
  ensureVersionTable(db)
  return db
    .prepare(
      `SELECT version, name, checksum, applied_at AS appliedAt
         FROM schema_version
        ORDER BY version`
    )
    .all() as AppliedMigration[]
}

export interface MigrateResult {
  readonly applied: number[]
  readonly version: number
}

export function migrate(db: SqlDatabase, migrations: readonly Migration[]): MigrateResult {
  ensureVersionTable(db)

  const applied = appliedMigrations(db)
  const byVersion = new Map(migrations.map((m) => [m.version, m]))

  for (const record of applied) {
    const migration = byVersion.get(record.version)
    if (!migration) {
      throw new MigrationError(
        `Database is at version ${record.version} ("${record.name}") but this build has no such migration. ` +
          'The database was created by a newer build; migrations are forward-only.'
      )
    }
    if (migration.checksum !== record.checksum) {
      throw new MigrationError(
        `Migration ${record.version} ("${record.name}") has changed since it was applied. ` +
          'Applied migrations are immutable — add a new migration instead of editing this one.'
      )
    }
  }

  const appliedVersions = new Set(applied.map((record) => record.version))
  const pending = migrations.filter((migration) => !appliedVersions.has(migration.version))

  const record = db.prepare(
    `INSERT INTO schema_version (version, name, checksum, applied_at)
     VALUES (@version, @name, @checksum, @appliedAt)`
  )

  for (const migration of pending) {
    if (migration.foreignKeysOff) db.pragma('foreign_keys = OFF')

    db.exec('BEGIN')
    try {
      db.exec(migration.sql)

      if (migration.foreignKeysOff) {
        const violations = db.prepare('PRAGMA foreign_key_check').all()
        if (violations.length > 0) {
          throw new Error(
            `${violations.length} foreign key violation(s) after rebuild: ` +
              JSON.stringify(violations.slice(0, 3))
          )
        }
      }

      record.run({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        appliedAt: new Date().toISOString()
      })
      db.exec('COMMIT')
    } catch (cause) {
      db.exec('ROLLBACK')
      throw new MigrationError(
        `Migration ${migration.version} ("${migration.name}") failed and was rolled back: ${
          cause instanceof Error ? cause.message : String(cause)
        }`
      )
    } finally {
      if (migration.foreignKeysOff) db.pragma('foreign_keys = ON')
    }
  }

  const versions = migrations.map((m) => m.version)
  return {
    applied: pending.map((m) => m.version),
    version: versions.length ? Math.max(...versions) : 0
  }
}

export function migrateFromDir(db: SqlDatabase, dir: string): MigrateResult {
  return migrate(db, loadMigrations(dir))
}
