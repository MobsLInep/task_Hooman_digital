import type { SqlDatabase } from '../database'
import { WorkspaceScopedRepository } from './base'
import type { ActivityRow } from './types'

const COLUMNS = `id,
       workspace_id AS workspaceId,
       kind,
       summary,
       meta_json    AS metaJson,
       created_at   AS createdAt`

export interface NewActivity {
  id: string
  kind: string
  summary: string
  metaJson?: string | null
}

export class ActivityRepository extends WorkspaceScopedRepository {
  constructor(db: SqlDatabase, workspaceId: string) {
    super(db, workspaceId)
  }

  log(entry: NewActivity): void {
    this.run(
      `INSERT INTO activity (id, workspace_id, kind, summary, meta_json, created_at)
       VALUES (@id, @workspaceId, @kind, @summary, @metaJson, @createdAt)`,
      {
        id: entry.id,
        kind: entry.kind,
        summary: entry.summary,
        metaJson: entry.metaJson ?? null,
        createdAt: new Date().toISOString()
      }
    )
  }

  recent(limit = 50): ActivityRow[] {
    return this.all<ActivityRow>(
      `SELECT ${COLUMNS} FROM activity
        WHERE workspace_id = @workspaceId
        ORDER BY created_at DESC
        LIMIT @limit`,
      { limit }
    )
  }
}
