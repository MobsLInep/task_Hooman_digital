import type { ChunkRepository, DocumentRepository, DocumentRow } from '../persistence'
import { chunkDocument, type ChunkOptions } from './chunk'
import { admit } from './detect'
import { sha256 } from './hash'
import {
  DocumentImportError,
  FAILURE_MESSAGES,
  type DocumentKind,
  type DuplicateResolution,
  type FailureReason,
  type ImportCandidate,
  type ImportOutcome,
  type ParsedDocument
} from './types'

export type ParseFn = (
  bytes: Uint8Array,
  kind: DocumentKind,
  filename: string
) => Promise<ParsedDocument>

export interface IngestDeps {
  documents: DocumentRepository
  chunks: ChunkRepository
  parse: ParseFn
  newId: () => string
  now?: () => Date
  chunkOptions?: ChunkOptions
  log?: (line: string) => void
}

export interface IngestRequest {
  candidate: ImportCandidate
  readBytes: () => Promise<Uint8Array>
  onDuplicate?: DuplicateResolution
}

const MIME_BY_KIND: Record<DocumentKind, string> = {
  pdf: 'application/pdf',
  markdown: 'text/markdown',
  text: 'text/plain'
}

export class DocumentPipeline {
  readonly #deps: IngestDeps

  constructor(deps: IngestDeps) {
    this.#deps = deps
  }

  async ingest(request: IngestRequest): Promise<ImportOutcome> {
    const { candidate } = request

    let kind: DocumentKind
    try {
      kind = admit(candidate)
    } catch (error) {
      return failure(error)
    }

    let bytes: Uint8Array
    try {
      bytes = await request.readBytes()
    } catch (cause) {
      this.#deps.log?.(`[documents] read failed for ${candidate.filename}: ${String(cause)}`)
      return { status: 'failed', reason: 'malformed', message: FAILURE_MESSAGES.malformed }
    }

    if (bytes.byteLength === 0) {
      return { status: 'failed', reason: 'empty_file', message: FAILURE_MESSAGES.empty_file }
    }

    const digest = sha256(bytes)

    const existing = this.#deps.documents.findBySha256(digest)
    if (existing) {
      if (!request.onDuplicate) {
        return {
          status: 'duplicate',
          existingDocumentId: existing.id,
          filename: existing.filename,
          sha256: digest
        }
      }
      if (request.onDuplicate === 'link-existing') {
        return {
          status: 'ready',
          documentId: existing.id,
          chunks: this.#deps.chunks.listByDocument(existing.id).length,
          pageCount: existing.pageCount ?? 0
        }
      }
    }

    const documentId = this.#deps.newId()

    const row = this.#deps.documents.create({
      id: documentId,
      filename: candidate.filename,
      mime: candidate.mime ?? MIME_BY_KIND[kind],
      sha256: digest,
      sizeBytes: candidate.sizeBytes,
      status: 'pending',
      createdAt: (this.#deps.now?.() ?? new Date()).toISOString()
    })

    return this.#parseAndIndex(row, bytes, kind)
  }

  async reparse(documentId: string, bytes: Uint8Array, kind: DocumentKind): Promise<ImportOutcome> {
    const row = this.#deps.documents.find(documentId)
    if (!row) {
      return { status: 'failed', reason: 'unknown', message: `No document ${documentId}` }
    }
    this.#deps.chunks.deleteByDocument(documentId)
    return this.#parseAndIndex(row, bytes, kind)
  }

  async #parseAndIndex(
    row: DocumentRow,
    bytes: Uint8Array,
    kind: DocumentKind
  ): Promise<ImportOutcome> {
    const { documents, chunks, parse, newId, log } = this.#deps

    documents.setStatus(row.id, 'parsing')

    let parsed: ParsedDocument
    try {
      parsed = await parse(bytes, kind, row.filename)
    } catch (error) {
      const { reason, message } = describe(error)
      documents.markFailed(row.id, reason, message)
      log?.(`[documents] ${row.filename} failed: ${reason}`)
      return { status: 'failed', reason, message }
    }

    try {
      const produced = chunkDocument(parsed, this.#deps.chunkOptions)

      if (produced.length === 0) {
        documents.markFailed(row.id, 'no_text_layer', FAILURE_MESSAGES.no_text_layer)
        return {
          status: 'failed',
          reason: 'no_text_layer',
          message: FAILURE_MESSAGES.no_text_layer
        }
      }

      chunks.insertMany(
        produced.map((chunk) => ({
          id: newId(),
          documentId: row.id,
          ordinal: chunk.ordinal,
          text: chunk.text,
          tokenEstimate: chunk.tokens,
          pageFrom: chunk.pageFrom,
          pageTo: chunk.pageTo
        }))
      )

      documents.markReady(
        row.id,
        parsed.pageCount,
        (this.#deps.now?.() ?? new Date()).toISOString()
      )
      log?.(
        `[documents] ${row.filename} ready: ${produced.length} chunks, ${parsed.pageCount} pages`
      )

      return {
        status: 'ready',
        documentId: row.id,
        chunks: produced.length,
        pageCount: parsed.pageCount
      }
    } catch (error) {
      const { reason, message } = describe(error)
      documents.markFailed(row.id, reason, message)
      return { status: 'failed', reason, message }
    }
  }
}

export function describe(error: unknown): { reason: FailureReason; message: string } {
  if (error instanceof DocumentImportError) {
    return { reason: error.reason, message: error.message }
  }
  const text = error instanceof Error ? error.message : String(error)
  return { reason: 'unknown', message: `${FAILURE_MESSAGES.unknown} (${text})` }
}

function failure(error: unknown): ImportOutcome {
  const { reason, message } = describe(error)
  return { status: 'failed', reason, message }
}
