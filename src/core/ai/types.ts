export interface ModelInfo {
  id: string
  family?: string
  nodeCount?: number
  tps?: number
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  contextTokens?: number
  tools?: ToolSpec[]
}

export type StreamErrorCode = 'network' | 'timeout' | 'provider' | 'cancelled'
export type FinishReason = 'stop' | 'length' | 'cancelled' | 'error'

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'error'; code: StreamErrorCode; message: string; retryable: boolean }
  | { type: 'done'; finishReason: FinishReason }

export interface ProviderCapabilities {
  nativeTools: boolean
  streaming: boolean
  maxContextTokens: number
}

export interface AiProvider {
  readonly id: string
  readonly capabilities: ProviderCapabilities
  listModels(): Promise<ModelInfo[]>
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>
}
