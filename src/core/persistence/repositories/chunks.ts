import type { SqlDatabase } from '../database'
import { WorkspaceScopedRepository } from './base'
import type { ChunkRow } from './types'

const COLUMNS = `id,
       document_id    AS documentId,
       workspace_id   AS workspaceId,
       ordinal,
       text,
       token_estimate AS tokenEstimate,
       page_from      AS pageFrom,
       page_to        AS pageTo`

export interface NewChunk {
  id: string
  documentId: string
  ordinal: number
  text: string
  tokenEstimate?: number | null
  pageFrom?: number | null
  pageTo?: number | null
}

export interface ChunkSearchHit extends ChunkRow {
  score: number
}

export class ChunkRepository extends WorkspaceScopedRepository {
  constructor(db: SqlDatabase, workspaceId: string) {
    super(db, workspaceId)
  }

  listByDocument(documentId: string): ChunkRow[] {
    return this.all<ChunkRow>(
      `SELECT ${COLUMNS} FROM chunks
        WHERE workspace_id = @workspaceId AND document_id = @documentId
        ORDER BY ordinal`,
      { documentId }
    )
  }

  insert(chunk: NewChunk): void {
    this.run(
      `INSERT INTO chunks
         (id, document_id, workspace_id, ordinal, text, token_estimate, page_from, page_to)
       VALUES (@id, @documentId, @workspaceId, @ordinal, @text, @tokenEstimate, @pageFrom, @pageTo)`,
      {
        id: chunk.id,
        documentId: chunk.documentId,
        ordinal: chunk.ordinal,
        text: chunk.text,
        tokenEstimate: chunk.tokenEstimate ?? null,
        pageFrom: chunk.pageFrom ?? null,
        pageTo: chunk.pageTo ?? null
      }
    )
  }

  insertMany(chunks: readonly NewChunk[]): void {
    for (const chunk of chunks) this.insert(chunk)
  }

  search(query: string, limit = 20): ChunkSearchHit[] {
    return this.all<ChunkSearchHit>(
      `SELECT c.id,
              c.document_id    AS documentId,
              c.workspace_id   AS workspaceId,
              c.ordinal,
              c.text,
              c.token_estimate AS tokenEstimate,
              c.page_from      AS pageFrom,
              c.page_to        AS pageTo,
              bm25(chunks_fts) AS score
         FROM chunks_fts
         JOIN chunks c ON c.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH @query
          AND c.workspace_id = @workspaceId
        ORDER BY score
        LIMIT @limit`,
      { query, limit }
    )
  }

  deleteByDocument(documentId: string): number {
    return this.run(
      `DELETE FROM chunks WHERE workspace_id = @workspaceId AND document_id = @documentId`,
      { documentId }
    )
  }
}
