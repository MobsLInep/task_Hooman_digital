import {
  DocumentImportError,
  FAILURE_MESSAGES,
  type ParsedDocument,
  type ParsedPage
} from '../types'

export interface PdfLoader {
  (bytes: Uint8Array): Promise<PdfDocumentLike>
}

export interface PdfDocumentLike {
  numPages: number
  getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>
  destroy?(): Promise<void> | void
}

export const defaultPdfLoader: PdfLoader = async (bytes) => {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocumentLike> }
  }

  return pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,

    password: ''
  }).promise
}

interface TextItem {
  str?: string
  hasEOL?: boolean
}

export function joinTextItems(items: readonly unknown[]): string {
  let out = ''
  for (const raw of items) {
    const item = raw as TextItem
    if (typeof item.str !== 'string') continue
    out += item.str
    if (item.hasEOL) out += '\n'
  }
  return out
}

export async function parsePdf(
  bytes: Uint8Array,
  options: { loader?: PdfLoader; onProgress?: (page: number, total: number) => void } = {}
): Promise<ParsedDocument> {
  const load = options.loader ?? defaultPdfLoader

  let document: PdfDocumentLike
  try {
    document = await load(bytes)
  } catch (cause) {
    throw classifyLoadFailure(cause)
  }

  try {
    const pages: ParsedPage[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      let text = ''
      try {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        text = joinTextItems(content.items)
      } catch {
        text = ''
      }
      pages.push({ pageNumber, text: normalise(text) })
      options.onProgress?.(pageNumber, document.numPages)
    }

    if (!pages.some((page) => page.text.trim().length > 0)) {
      throw new DocumentImportError('no_text_layer', FAILURE_MESSAGES.no_text_layer, {
        pageCount: document.numPages
      })
    }

    return { kind: 'pdf', pages, pageCount: document.numPages }
  } finally {
    try {
      await document.destroy?.()
    } catch {}
  }
}

export function classifyLoadFailure(cause: unknown): DocumentImportError {
  const name = (cause as { name?: string })?.name ?? ''
  const message = cause instanceof Error ? cause.message : String(cause)

  if (name === 'PasswordException' || /password/i.test(message)) {
    return new DocumentImportError('encrypted', FAILURE_MESSAGES.encrypted, { cause: message })
  }
  if (name === 'InvalidPDFException' || /invalid pdf|structure/i.test(message)) {
    return new DocumentImportError('malformed', FAILURE_MESSAGES.malformed, { cause: message })
  }
  if (name === 'MissingPDFException' || /missing pdf/i.test(message)) {
    return new DocumentImportError('malformed', FAILURE_MESSAGES.malformed, { cause: message })
  }
  return new DocumentImportError('malformed', FAILURE_MESSAGES.malformed, { cause: message, name })
}

function normalise(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
