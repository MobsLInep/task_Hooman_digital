import type { ParsedDocument } from '../types'

export function parseText(bytes: Uint8Array, kind: 'text' | 'markdown'): ParsedDocument {
  const text = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes)

    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

    .replace(/^\uFEFF/, '')

  return { kind, pages: [{ pageNumber: 1, text }], pageCount: 1 }
}
