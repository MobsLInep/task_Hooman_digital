import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { applyPragmas, migrateFromDir, type SqlDatabase } from '@core/persistence'

let db: Database.Database | undefined

function migrationsDir(): string {
  return join(__dirname, 'migrations')
}

export function openDatabase(): Database.Database {
  if (db) return db

  db = new Database(join(app.getPath('userData'), 'task1.db'))
  applyPragmas(db as unknown as SqlDatabase)

  const result = migrateFromDir(db as unknown as SqlDatabase, migrationsDir())
  if (result.applied.length) {
    console.log(`[db] applied migrations ${result.applied.join(', ')} (now at ${result.version})`)
  }

  return db
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database accessed before openDatabase()')
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = undefined
}
