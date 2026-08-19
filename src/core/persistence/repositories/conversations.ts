import type { SqlDatabase } from '../database'
import { WorkspaceScopedRepository, type QueryParams } from './base'
import type { ConversationRow, SqlBool } from './types'

const COLUMNS = `id,
       workspace_id  AS workspaceId,
       title,
       model_id      AS modelId,
       system_prompt AS systemPrompt,
       pinned,
       created_at    AS createdAt,
       updated_at    AS updatedAt`

export interface NewConversation {
  id: string
  title: string
  modelId?: string | null
  systemPrompt?: string | null
  createdAt?: string
}

export class ConversationRepository extends WorkspaceScopedRepository {
  constructor(db: SqlDatabase, workspaceId: string) {
    super(db, workspaceId)
  }

  list(): ConversationRow[] {
    return this.all<ConversationRow>(
      `SELECT ${COLUMNS} FROM conversations
        WHERE workspace_id = @workspaceId
        ORDER BY pinned DESC, updated_at DESC`
    )
  }

  find(id: string): ConversationRow | undefined {
    return this.get<ConversationRow>(
      `SELECT ${COLUMNS} FROM conversations
        WHERE workspace_id = @workspaceId AND id = @id`,
      { id }
    )
  }

  create(conversation: NewConversation): ConversationRow {
    const now = conversation.createdAt ?? new Date().toISOString()
    this.run(
      `INSERT INTO conversations
         (id, workspace_id, title, model_id, system_prompt, pinned, created_at, updated_at)
       VALUES (@id, @workspaceId, @title, @modelId, @systemPrompt, 0, @now, @now)`,
      {
        id: conversation.id,
        title: conversation.title,
        modelId: conversation.modelId ?? null,
        systemPrompt: conversation.systemPrompt ?? null,
        now
      } satisfies QueryParams
    )
    return this.find(conversation.id)!
  }

  rename(id: string, title: string): boolean {
    return (
      this.run(
        `UPDATE conversations
            SET title = @title, updated_at = @now
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, title, now: new Date().toISOString() }
      ) > 0
    )
  }

  setPinned(id: string, pinned: boolean): boolean {
    return (
      this.run(
        `UPDATE conversations
            SET pinned = @pinned, updated_at = @now
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, pinned: (pinned ? 1 : 0) satisfies SqlBool, now: new Date().toISOString() }
      ) > 0
    )
  }

  touch(id: string): void {
    this.run(
      `UPDATE conversations
          SET updated_at = @now
        WHERE workspace_id = @workspaceId AND id = @id`,
      { id, now: new Date().toISOString() }
    )
  }

  delete(id: string): boolean {
    return (
      this.run(`DELETE FROM conversations WHERE workspace_id = @workspaceId AND id = @id`, { id }) >
      0
    )
  }
}
