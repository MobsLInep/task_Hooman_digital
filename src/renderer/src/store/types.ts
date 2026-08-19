export interface Workspace {
  id: string
  name: string
  createdAt: string
  settingsJson: string
}

export interface Conversation {
  id: string
  workspaceId: string
  title: string
  modelId: string | null
  pinned: 0 | 1
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  conversationId: string
  workspaceId: string
  role: 'system' | 'user' | 'assistant'
  content: string
  status: 'pending' | 'streaming' | 'complete' | 'error' | 'cancelled'
  tokenEstimate: number | null
  provenanceJson: string | null
  prevMessageId: string | null
  createdAt: string
}

export interface DocumentRow {
  id: string
  workspaceId: string
  filename: string
  mime: string
  sha256: string
  sizeBytes: number
  status: 'pending' | 'parsing' | 'ready' | 'failed'
  failureReason: string | null
  error: string | null
  pageCount: number | null
  createdAt: string
}

export interface Note {
  id: string
  workspaceId: string
  title: string
  body: string
  pinned: 0 | 1
  updatedAt: string
}

export interface ActiveTask {
  id: string
  workspaceId: string
  workspaceName: string
  type: string
  status: 'queued' | 'running'
  createdAt: string
}

export interface ActivityRow {
  id: string
  kind: string
  summary: string
  metaJson: string | null
  createdAt: string
}

export interface ToolInvocationMeta {
  tool: string
  argsRedacted: string
  durationMs: number
  outcome: string
}

export interface ContextReport {
  budget: { modelLimit: number; reservedOutput: number; safetyMargin: number; usable: number }
  tiers: {
    tier: number
    name: string
    cap: number
    allocated: number
    used: number
    cascadedIn: number
    cascadedOut: number
    includedIds: string[]
    excludedIds: string[]
  }[]
  included: { id: string; kind: string; tier: number; tokens: number; truncated: boolean }[]
  excluded: {
    id: string
    kind: string
    tier: number
    tokens: number
    reason: string
    detail: string
  }[]
  ladder: { step: number; tier: number; action: string; itemIds: string[] }[]
  overhead: number
  total: number
  headroom: number
  counterId: string
}

export interface GenerationSnapshot {
  conversationId: string
  generating: boolean
  text: string
  toolCalls: { id: string; name: string; args: unknown }[]
  startedAt: number | undefined
  lastOutcome: 'complete' | 'cancelled' | 'error' | undefined
  lastError: string | undefined
}

export type AppEvent =
  | { type: 'delta'; conversationId: string; text: string }
  | { type: 'tool_call'; conversationId: string; call: { id: string; name: string; args: unknown } }
  | { type: 'state'; conversationId: string; generating: boolean }
  | { type: 'settled'; conversationId: string; outcome: string; messageId?: string; error?: string }
  | { type: 'documents:changed'; workspaceId: string }
  | { type: 'tasks:changed' }
