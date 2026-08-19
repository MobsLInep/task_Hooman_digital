import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import {
  applyPragmas,
  loadMigrations,
  migrate,
  type Migration,
  type SqlDatabase
} from '@core/persistence'

export const MIGRATIONS_DIR = resolve(__dirname, '../../../src/core/persistence/migrations')

export function realMigrations(): Migration[] {
  return loadMigrations(MIGRATIONS_DIR)
}

export function openTestDb(): Database.Database & SqlDatabase {
  const db = new Database(':memory:')
  applyPragmas(db as unknown as SqlDatabase)
  return db as Database.Database & SqlDatabase
}

export function migratedDb(): Database.Database & SqlDatabase {
  const db = openTestDb()
  migrate(db as unknown as SqlDatabase, realMigrations())
  return db
}

let counter = 0
export const id = (prefix: string): string => `${prefix}-${++counter}`
