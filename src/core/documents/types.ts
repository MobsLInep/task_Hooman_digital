export type DocumentKind = 'pdf' | 'markdown' | 'text'

export type DocumentStatus = 'pending' | 'parsing' | 'ready' | 'failed'

export type FailureReason =
  | 'unsupported_type'
  | 'too_large'
  | 'empty_file'
  | 'encrypted'
  | 'no_text_layer'
  | 'malformed'
  | 'parse_timeout'
  | 'worker_crashed'
  | 'unknown'

export class DocumentImportError extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
    readonly detail?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'DocumentImportError'
  }
}

export interface ParsedPage {
  pageNumber: number
  text: string
}

export interface ParsedDocument {
  kind: DocumentKind
  pages: ParsedPage[]
  pageCount: number
}

export interface DocumentChunk {
  ordinal: number
  text: string
  tokens: number
  pageFrom: number
  pageTo: number
}

export interface ImportCandidate {
  filename: string
  sizeBytes: number
  mime?: string
}

export type ImportOutcome =
  | { status: 'ready'; documentId: string; chunks: number; pageCount: number }
  | { status: 'failed'; reason: FailureReason; message: string }
  | {
      status: 'duplicate'
      existingDocumentId: string
      filename: string
      sha256: string
    }

export type DuplicateResolution = 'link-existing' | 'import-as-copy'

export const MAX_FILE_BYTES = 25 * 1024 * 1024

export const CHUNK_TARGET_TOKENS = 800

export const CHUNK_OVERLAP_TOKENS = 100

export const SUPPORTED_EXTENSIONS: Record<string, DocumentKind> = {
  '.pdf': 'pdf',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdown': 'markdown',
  '.txt': 'text',
  '.text': 'text',
  '.log': 'text'
}

export const SUPPORTED_MIME_TYPES: Record<string, DocumentKind> = {
  'application/pdf': 'pdf',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/plain': 'text'
}

export const FAILURE_MESSAGES: Record<FailureReason, string> = {
  unsupported_type:
    'That file type is not supported. You can import PDF, Markdown (.md) and plain text (.txt) files.',
  too_large: `That file is larger than the ${Math.round(
    MAX_FILE_BYTES / (1024 * 1024)
  )} MB limit. Try splitting it into smaller files.`,
  empty_file: 'That file is empty, so there is nothing to import.',
  encrypted:
    'That PDF is password-protected. Remove the password and try again — we cannot open encrypted PDFs.',
  no_text_layer:
    'That PDF has no selectable text. It is most likely a scan, and this app does not perform OCR, so there is nothing to index.',
  malformed:
    'That file could not be read. It may be corrupted or not really the type its name suggests.',
  parse_timeout:
    'That file took too long to read and was stopped. Very large or unusual PDFs can do this.',
  worker_crashed:
    'Reading that file failed unexpectedly. The rest of the app is unaffected — please try again.',
  unknown: 'Something went wrong while importing that file.'
}
