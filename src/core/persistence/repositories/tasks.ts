import type { SqlDatabase } from '../database'
import { WorkspaceScopedRepository } from './base'
import type { TaskRow, TaskStatus } from './types'

const COLUMNS = `id,
       workspace_id     AS workspaceId,
       type,
       status,
       params_json      AS paramsJson,
       result_json      AS resultJson,
       error,
       attempts,
       partial_json     AS partialJson,
       lease_expires_at AS leaseExpiresAt,
       created_at       AS createdAt,
       updated_at       AS updatedAt`

export interface NewTask {
  id: string
  type: string
  paramsJson?: string
}

export class TaskRepository extends WorkspaceScopedRepository {
  constructor(db: SqlDatabase, workspaceId: string) {
    super(db, workspaceId)
  }

  find(id: string): TaskRow | undefined {
    return this.get<TaskRow>(
      `SELECT ${COLUMNS} FROM tasks WHERE workspace_id = @workspaceId AND id = @id`,
      { id }
    )
  }

  listByStatus(status: TaskStatus): TaskRow[] {
    return this.all<TaskRow>(
      `SELECT ${COLUMNS} FROM tasks
        WHERE workspace_id = @workspaceId AND status = @status
        ORDER BY created_at`,
      { status }
    )
  }

  enqueue(task: NewTask): TaskRow {
    const now = new Date().toISOString()
    this.run(
      `INSERT INTO tasks
         (id, workspace_id, type, status, params_json, attempts, created_at, updated_at)
       VALUES (@id, @workspaceId, @type, 'queued', @paramsJson, 0, @now, @now)`,
      { id: task.id, type: task.type, paramsJson: task.paramsJson ?? '{}', now }
    )
    return this.find(task.id)!
  }

  claim(leaseSeconds = 60, now = new Date()): TaskRow | undefined {
    const nowIso = now.toISOString()
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString()

    const candidate = this.get<{ id: string }>(
      `SELECT id FROM tasks
        WHERE workspace_id = @workspaceId
          AND (status = 'queued'
               OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < @now))
        ORDER BY created_at
        LIMIT 1`,
      { now: nowIso }
    )
    if (!candidate) return undefined

    const claimed = this.run(
      `UPDATE tasks
          SET status = 'running',
              attempts = attempts + 1,
              lease_expires_at = @leaseExpiresAt,
              updated_at = @now
        WHERE workspace_id = @workspaceId
          AND id = @id
          AND (status = 'queued'
               OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < @now))`,
      { id: candidate.id, leaseExpiresAt, now: nowIso }
    )

    return claimed > 0 ? this.find(candidate.id) : undefined
  }

  checkpoint(id: string, partialJson: string): boolean {
    return (
      this.run(
        `UPDATE tasks
            SET partial_json = @partialJson, updated_at = @now
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, partialJson, now: new Date().toISOString() }
      ) > 0
    )
  }

  requeue(id: string, error: string): boolean {
    return (
      this.run(
        `UPDATE tasks
            SET status = 'queued', error = @error, lease_expires_at = NULL, updated_at = @now
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, error, now: new Date().toISOString() }
      ) > 0
    )
  }

  complete(id: string, resultJson: string | null = null): boolean {
    return (
      this.run(
        `UPDATE tasks
            SET status = 'done', result_json = @resultJson, error = NULL,
                lease_expires_at = NULL, updated_at = @now
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, resultJson, now: new Date().toISOString() }
      ) > 0
    )
  }

  fail(id: string, error: string): boolean {
    return (
      this.run(
        `UPDATE tasks
            SET status = 'failed', error = @error, lease_expires_at = NULL, updated_at = @now
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, error, now: new Date().toISOString() }
      ) > 0
    )
  }
}
