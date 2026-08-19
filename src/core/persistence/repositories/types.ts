export type SqlBool = 0 | 1

export interface WorkspaceRow {
  id: string
  name: string
  createdAt: string
  settingsJson: string
}

export interface ConversationRow {
  id: string
  workspaceId: string
  title: string
  modelId: string | null
  systemPrompt: string | null
  pinned: SqlBool
  createdAt: string
  updatedAt: string
}

export type MessageRole = 'system' | 'user' | 'assistant'
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'cancelled'

export interface MessageRow {
  id: string
  conversationId: string
  workspaceId: string
  role: MessageRole
  content: string
  status: MessageStatus
  tokenEstimate: number | null
  provenanceJson: string | null
  createdAt: string
  prevMessageId: string | null
}

export type DocumentStatus = 'pending' | 'parsing' | 'ready' | 'failed'

export interface DocumentRow {
  id: string
  workspaceId: string
  filename: string
  mime: string
  sha256: string
  sizeBytes: number
  status: DocumentStatus
  failureReason: string | null
  error: string | null
  pageCount: number | null
  parsedAt: string | null
  createdAt: string
}

export interface ChunkRow {
  id: string
  documentId: string
  workspaceId: string
  ordinal: number
  text: string
  tokenEstimate: number | null
  pageFrom: number | null
  pageTo: number | null
}

export interface NoteRow {
  id: string
  workspaceId: string
  title: string
  body: string
  pinned: SqlBool
  updatedAt: string
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TaskRow {
  id: string
  workspaceId: string
  type: string
  status: TaskStatus
  paramsJson: string
  resultJson: string | null
  error: string | null
  attempts: number
  partialJson: string | null
  leaseExpiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ActivityRow {
  id: string
  workspaceId: string
  kind: string
  summary: string
  metaJson: string | null
  createdAt: string
}

export interface ProviderRow {
  id: string
  workspaceId: string
  name: string
  baseUrl: string
  modelId: string | null
  credentialRef: string | null
  isDefault: SqlBool
}
