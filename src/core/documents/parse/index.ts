import {
  DocumentImportError,
  FAILURE_MESSAGES,
  type DocumentKind,
  type ParsedDocument
} from '../types'
import { parsePdf, type PdfLoader } from './pdf'
import { parseText } from './text'

export * from './pdf'
export * from './text'

export async function parseDocument(
  bytes: Uint8Array,
  kind: DocumentKind,
  options: { loader?: PdfLoader } = {}
): Promise<ParsedDocument> {
  switch (kind) {
    case 'pdf':
      return parsePdf(bytes, options.loader ? { loader: options.loader } : {})
    case 'markdown':
      return parseText(bytes, 'markdown')
    case 'text':
      return parseText(bytes, 'text')
    default: {
      const exhaustive: never = kind
      throw new DocumentImportError('unsupported_type', FAILURE_MESSAGES.unsupported_type, {
        kind: exhaustive
      })
    }
  }
}
