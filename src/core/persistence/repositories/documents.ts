import type { SqlDatabase } from '../database'
import { WorkspaceScopedRepository } from './base'
import type { DocumentRow, DocumentStatus } from './types'

const COLUMNS = `id,
       workspace_id AS workspaceId,
       filename,
       mime,
       sha256,
       size_bytes     AS sizeBytes,
       status,
       failure_reason AS failureReason,
       error,
       page_count     AS pageCount,
       parsed_at      AS parsedAt,
       created_at     AS createdAt`

export interface NewDocument {
  id: string
  filename: string
  mime: string
  sha256: string
  sizeBytes: number
  status?: DocumentStatus
  pageCount?: number | null
  createdAt?: string
}

export class DocumentRepository extends WorkspaceScopedRepository {
  constructor(db: SqlDatabase, workspaceId: string) {
    super(db, workspaceId)
  }

  list(): DocumentRow[] {
    return this.all<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents
        WHERE workspace_id = @workspaceId
        ORDER BY created_at DESC`
    )
  }

  find(id: string): DocumentRow | undefined {
    return this.get<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents WHERE workspace_id = @workspaceId AND id = @id`,
      { id }
    )
  }

  findBySha256(sha256: string): DocumentRow | undefined {
    return this.get<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents
        WHERE workspace_id = @workspaceId AND sha256 = @sha256
        ORDER BY created_at, id
        LIMIT 1`,
      { sha256 }
    )
  }

  findAllBySha256(sha256: string): DocumentRow[] {
    return this.all<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents
        WHERE workspace_id = @workspaceId AND sha256 = @sha256
        ORDER BY created_at, id`,
      { sha256 }
    )
  }

  create(document: NewDocument): DocumentRow {
    this.run(
      `INSERT INTO documents
         (id, workspace_id, filename, mime, sha256, size_bytes, status, failure_reason,
          error, page_count, parsed_at, created_at)
       VALUES (@id, @workspaceId, @filename, @mime, @sha256, @sizeBytes, @status, NULL,
               NULL, @pageCount, NULL, @createdAt)`,
      {
        id: document.id,
        filename: document.filename,
        mime: document.mime,
        sha256: document.sha256,
        sizeBytes: document.sizeBytes,
        status: document.status ?? 'pending',
        pageCount: document.pageCount ?? null,
        createdAt: document.createdAt ?? new Date().toISOString()
      }
    )
    return this.find(document.id)!
  }

  setStatus(id: string, status: Exclude<DocumentStatus, 'failed'>): boolean {
    return (
      this.run(
        `UPDATE documents
            SET status = @status, failure_reason = NULL, error = NULL
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, status }
      ) > 0
    )
  }

  markReady(id: string, pageCount: number, parsedAt = new Date().toISOString()): boolean {
    return (
      this.run(
        `UPDATE documents
            SET status = 'ready', failure_reason = NULL, error = NULL,
                page_count = @pageCount, parsed_at = @parsedAt
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, pageCount, parsedAt }
      ) > 0
    )
  }

  markFailed(id: string, reason: string, message: string): boolean {
    return (
      this.run(
        `UPDATE documents
            SET status = 'failed', failure_reason = @reason, error = @message
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, reason, message }
      ) > 0
    )
  }

  listByStatus(status: DocumentStatus): DocumentRow[] {
    return this.all<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents
        WHERE workspace_id = @workspaceId AND status = @status
        ORDER BY created_at`,
      { status }
    )
  }

  delete(id: string): boolean {
    return (
      this.run(`DELETE FROM documents WHERE workspace_id = @workspaceId AND id = @id`, { id }) > 0
    )
  }
}
