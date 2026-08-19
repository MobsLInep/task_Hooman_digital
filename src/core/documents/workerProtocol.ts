import type { DocumentKind, FailureReason, ParsedDocument } from './types'

export interface ParseRequest {
  id: string
  kind: DocumentKind
  filename: string
  bytes: Uint8Array
}

export type ParseResponse =
  | { id: string; ok: true; document: ParsedDocument }
  | { id: string; ok: false; reason: FailureReason; message: string }

export interface ParseProgress {
  id: string
  type: 'progress'
  page: number
  totalPages: number
}

export type WorkerMessage = ParseResponse | ParseProgress

export function isProgress(message: WorkerMessage): message is ParseProgress {
  return 'type' in message && message.type === 'progress'
}
