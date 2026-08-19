import type { SqlDatabase } from '../database'
import { WorkspaceScopedRepository } from './base'
import type { NoteRow, SqlBool } from './types'

const COLUMNS = `id,
       workspace_id AS workspaceId,
       title,
       body,
       pinned,
       updated_at   AS updatedAt`

export interface NewNote {
  id: string
  title: string
  body?: string
  updatedAt?: string
}

export interface NoteSearchHit extends NoteRow {
  score: number
}

export class NoteRepository extends WorkspaceScopedRepository {
  constructor(db: SqlDatabase, workspaceId: string) {
    super(db, workspaceId)
  }

  list(): NoteRow[] {
    return this.all<NoteRow>(
      `SELECT ${COLUMNS} FROM notes
        WHERE workspace_id = @workspaceId
        ORDER BY pinned DESC, updated_at DESC`
    )
  }

  find(id: string): NoteRow | undefined {
    return this.get<NoteRow>(
      `SELECT ${COLUMNS} FROM notes WHERE workspace_id = @workspaceId AND id = @id`,
      { id }
    )
  }

  create(note: NewNote): NoteRow {
    this.run(
      `INSERT INTO notes (id, workspace_id, title, body, pinned, updated_at)
       VALUES (@id, @workspaceId, @title, @body, 0, @updatedAt)`,
      {
        id: note.id,
        title: note.title,
        body: note.body ?? '',
        updatedAt: note.updatedAt ?? new Date().toISOString()
      }
    )
    return this.find(note.id)!
  }

  update(id: string, title: string, body: string): boolean {
    return (
      this.run(
        `UPDATE notes
            SET title = @title, body = @body, updated_at = @now
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, title, body, now: new Date().toISOString() }
      ) > 0
    )
  }

  setPinned(id: string, pinned: boolean): boolean {
    return (
      this.run(`UPDATE notes SET pinned = @pinned WHERE workspace_id = @workspaceId AND id = @id`, {
        id,
        pinned: (pinned ? 1 : 0) satisfies SqlBool
      }) > 0
    )
  }

  search(query: string, limit = 20): NoteSearchHit[] {
    return this.all<NoteSearchHit>(
      `SELECT n.id,
              n.workspace_id  AS workspaceId,
              n.title,
              n.body,
              n.pinned,
              n.updated_at    AS updatedAt,
              bm25(notes_fts) AS score
         FROM notes_fts
         JOIN notes n ON n.rowid = notes_fts.rowid
        WHERE notes_fts MATCH @query
          AND n.workspace_id = @workspaceId
        ORDER BY score
        LIMIT @limit`,
      { query, limit }
    )
  }

  delete(id: string): boolean {
    return this.run(`DELETE FROM notes WHERE workspace_id = @workspaceId AND id = @id`, { id }) > 0
  }
}
