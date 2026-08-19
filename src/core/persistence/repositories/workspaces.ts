import type { SqlDatabase } from '../database'
import { WorkspaceScopedRepository } from './base'
import type { WorkspaceRow } from './types'

const COLUMNS = `id,
       name,
       created_at    AS createdAt,
       settings_json AS settingsJson`

export class WorkspaceRepository extends WorkspaceScopedRepository {
  constructor(db: SqlDatabase, workspaceId: string) {
    super(db, workspaceId)
  }

  self(): WorkspaceRow | undefined {
    return this.get<WorkspaceRow>(
      `SELECT ${COLUMNS} FROM workspaces WHERE workspaces.id = @workspaceId`
    )
  }

  updateSettings(settingsJson: string): boolean {
    return (
      this.run(
        `UPDATE workspaces SET settings_json = @settingsJson
          WHERE workspaces.id = @workspaceId`,
        { settingsJson }
      ) > 0
    )
  }

  rename(name: string): boolean {
    return (
      this.run(`UPDATE workspaces SET name = @name WHERE workspaces.id = @workspaceId`, { name }) >
      0
    )
  }
}

export class WorkspaceDirectory {
  constructor(private readonly db: SqlDatabase) {}

  list(): WorkspaceRow[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM workspaces ORDER BY created_at`)
      .all() as WorkspaceRow[]
  }

  find(id: string): WorkspaceRow | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM workspaces WHERE id = @id`).get({ id }) as
      WorkspaceRow | undefined
  }

  create(id: string, name: string, settingsJson = '{}'): WorkspaceRow {
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, created_at, settings_json)
         VALUES (@id, @name, @createdAt, @settingsJson)`
      )
      .run({ id, name, createdAt: new Date().toISOString(), settingsJson })
    return this.find(id)!
  }

  delete(id: string): boolean {
    return this.db.prepare(`DELETE FROM workspaces WHERE id = @id`).run({ id }).changes > 0
  }
}
