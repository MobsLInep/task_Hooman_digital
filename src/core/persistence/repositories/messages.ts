import type { SqlDatabase } from '../database'
import { WorkspaceScopedRepository } from './base'
import type { MessageRole, MessageRow, MessageStatus } from './types'

const COLUMNS = `id,
       conversation_id AS conversationId,
       workspace_id    AS workspaceId,
       role,
       content,
       status,
       token_estimate  AS tokenEstimate,
       provenance_json AS provenanceJson,
       created_at      AS createdAt,
       prev_message_id AS prevMessageId`

export interface NewMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  status?: MessageStatus
  tokenEstimate?: number | null
  provenanceJson?: string | null
  createdAt?: string
  prevMessageId?: string | null
}

export class MessageRepository extends WorkspaceScopedRepository {
  constructor(db: SqlDatabase, workspaceId: string) {
    super(db, workspaceId)
  }

  listByConversation(conversationId: string): MessageRow[] {
    return this.all<MessageRow>(
      `SELECT ${COLUMNS} FROM messages
        WHERE workspace_id = @workspaceId AND conversation_id = @conversationId
        ORDER BY created_at, rowid`,
      { conversationId }
    )
  }

  find(id: string): MessageRow | undefined {
    return this.get<MessageRow>(
      `SELECT ${COLUMNS} FROM messages WHERE workspace_id = @workspaceId AND id = @id`,
      { id }
    )
  }

  append(message: NewMessage): MessageRow {
    this.run(
      `INSERT INTO messages
         (id, conversation_id, workspace_id, role, content, status,
          token_estimate, provenance_json, created_at, prev_message_id)
       VALUES (@id, @conversationId, @workspaceId, @role, @content, @status,
               @tokenEstimate, @provenanceJson, @createdAt, @prevMessageId)`,
      {
        id: message.id,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        status: message.status ?? 'complete',
        tokenEstimate: message.tokenEstimate ?? null,
        provenanceJson: message.provenanceJson ?? null,
        createdAt: message.createdAt ?? new Date().toISOString(),
        prevMessageId: message.prevMessageId ?? null
      }
    )
    return this.find(message.id)!
  }

  update(id: string, content: string, status: MessageStatus, tokenEstimate?: number): boolean {
    return (
      this.run(
        `UPDATE messages
            SET content = @content, status = @status, token_estimate = @tokenEstimate
          WHERE workspace_id = @workspaceId AND id = @id`,
        { id, content, status, tokenEstimate: tokenEstimate ?? null }
      ) > 0
    )
  }

  successors(id: string): MessageRow[] {
    return this.all<MessageRow>(
      `SELECT ${COLUMNS} FROM messages
        WHERE workspace_id = @workspaceId AND prev_message_id = @id
        ORDER BY created_at`,
      { id }
    )
  }

  delete(id: string): boolean {
    return (
      this.run(`DELETE FROM messages WHERE workspace_id = @workspaceId AND id = @id`, { id }) > 0
    )
  }
}
