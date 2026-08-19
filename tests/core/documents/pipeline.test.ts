import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  Bm25Retriever,
  DocumentPipeline,
  MAX_FILE_BYTES,
  admit,
  chunkDocument,
  detectKind,
  parseDocument,
  sha256,
  toMatchQuery,
  type ImportOutcome,
  type ParsedDocument
} from '@core/documents'
import { WorkspaceDirectory, WorkspaceRepositories, type SqlDatabase } from '@core/persistence'
import { handleParseRequest } from '../../../src/workers/documentParser'
import { migratedDb } from '../persistence/helpers'
import { buildPdf, corruptPdf, notAPdf } from './pdfFixture'

let db: Database.Database & SqlDatabase
let repos: WorkspaceRepositories
let ids: number

const newId = (): string => `id-${++ids}`

function pipeline(overrides: Partial<ConstructorParameters<typeof DocumentPipeline>[0]> = {}) {
  return new DocumentPipeline({
    documents: repos.documents,
    chunks: repos.chunks,
    parse: (bytes, kind) => parseDocument(bytes, kind),
    newId,
    ...overrides
  })
}

function ingest(
  filename: string,
  bytes: Uint8Array,
  extra: { onDuplicate?: 'link-existing' | 'import-as-copy'; sizeBytes?: number } = {}
): Promise<ImportOutcome> {
  return pipeline().ingest({
    candidate: { filename, sizeBytes: extra.sizeBytes ?? bytes.byteLength },
    readBytes: async () => bytes,
    ...(extra.onDuplicate ? { onDuplicate: extra.onDuplicate } : {})
  })
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

beforeEach(() => {
  db = migratedDb()
  new WorkspaceDirectory(db).create('ws-a', 'A')
  repos = new WorkspaceRepositories(db, 'ws-a')
  ids = 0
})

describe('a 100-page PDF', () => {
  const hundredPages = (): Uint8Array =>
    buildPdf(
      Array.from(
        { length: 100 },
        (_, i) =>
          `Page ${i + 1} discusses subject ${i % 7}. ` +
          'It carries several sentences of body text so that chunking has something to work with. ' +
          `The distinctive marker for this page is kestrel-${i + 1}.`
      )
    )

  it('parses all 100 pages', async () => {
    const parsed = await parseDocument(hundredPages(), 'pdf')
    expect(parsed.pageCount).toBe(100)
    expect(parsed.pages).toHaveLength(100)
    expect(parsed.pages[0]!.text).toContain('Page 1 discusses')
    expect(parsed.pages[99]!.text).toContain('Page 100 discusses')
  })

  it('produces chunks whose page ranges are ordered, contiguous and truthful', async () => {
    const parsed = await parseDocument(hundredPages(), 'pdf')
    const chunks = chunkDocument(parsed)

    expect(chunks.length).toBeGreaterThan(1)

    for (const chunk of chunks) {
      expect(chunk.pageFrom).toBeGreaterThanOrEqual(1)
      expect(chunk.pageTo).toBeLessThanOrEqual(100)
      expect(chunk.pageFrom).toBeLessThanOrEqual(chunk.pageTo)

      const markers = [...chunk.text.matchAll(/kestrel-(\d+)/g)].map((m) => Number(m[1]))
      for (const marker of markers) {
        expect(
          marker,
          `chunk ${chunk.ordinal} claims pages ${chunk.pageFrom}-${chunk.pageTo}`
        ).toBeGreaterThanOrEqual(chunk.pageFrom)
        expect(marker).toBeLessThanOrEqual(chunk.pageTo)
      }
    }

    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i))
    expect(Math.min(...chunks.map((c) => c.pageFrom))).toBe(1)
    expect(Math.max(...chunks.map((c) => c.pageTo))).toBe(100)

    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.pageFrom).toBeGreaterThanOrEqual(chunks[i - 1]!.pageFrom)
    }

    const seen = new Set(
      chunks.flatMap((c) => [...c.text.matchAll(/kestrel-(\d+)/g)].map((m) => Number(m[1])))
    )
    expect(seen.size).toBe(100)
  })

  it('ingests, indexes and reports ready with the page count', async () => {
    const outcome = await ingest('hundred.pdf', hundredPages())

    expect(outcome.status).toBe('ready')
    if (outcome.status !== 'ready') return

    expect(outcome.pageCount).toBe(100)
    expect(outcome.chunks).toBeGreaterThan(1)

    const row = repos.documents.find(outcome.documentId)!
    expect(row.status).toBe('ready')
    expect(row.failureReason).toBeNull()
    expect(row.pageCount).toBe(100)
    expect(row.parsedAt).toBeTruthy()

    const stored = repos.chunks.listByDocument(outcome.documentId)
    expect(stored).toHaveLength(outcome.chunks)
    expect(stored.every((c) => c.pageFrom !== null && c.pageTo !== null)).toBe(true)
  })

  it('is retrievable by BM25 with a citable page range', async () => {
    const outcome = await ingest('hundred.pdf', hundredPages())
    if (outcome.status !== 'ready') throw new Error('setup failed')

    const hits = await new Bm25Retriever(repos.chunks).search('kestrel-42', 5)

    expect(hits.length).toBeGreaterThan(0)
    const hit = hits.find((h) => h.text.includes('kestrel-42'))!
    expect(hit).toBeDefined()
    expect(hit.pageFrom).toBeLessThanOrEqual(42)
    expect(hit.pageTo).toBeGreaterThanOrEqual(42)

    expect(hit.score).toBeGreaterThan(0)
  })
})

describe('failure reasons are distinct', () => {
  it.each([
    ['malformed (truncated)', () => corruptPdf(), 'malformed'],
    ['malformed (not a PDF)', () => notAPdf(), 'malformed'],
    ['encrypted', () => buildPdf(['secret'], { encrypted: true }), 'encrypted'],
    ['no text layer (scan)', () => buildPdf([null, null, null]), 'no_text_layer']
  ] as const)('%s -> %s', async (_label, make, expected) => {
    const outcome = await ingest('problem.pdf', make())

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return

    expect(outcome.reason).toBe(expected)
    expect(outcome.message).toBeTruthy()

    expect(outcome.message).not.toMatch(/^Something went wrong/)

    const rows = repos.documents.listByStatus('failed')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.failureReason).toBe(expected)
    expect(rows[0]!.error).toBe(outcome.message)
  })

  it('gives each cause a different reason and a different message', async () => {
    const outcomes = await Promise.all([
      ingest('a.pdf', corruptPdf()),
      ingest('b.pdf', buildPdf(['x'], { encrypted: true })),
      ingest('c.pdf', buildPdf([null])),
      ingest('d.exe', utf8('binary')),
      ingest('e.txt', utf8('x'), { sizeBytes: MAX_FILE_BYTES + 1 })
    ])

    const reasons = outcomes.map((o) => (o.status === 'failed' ? o.reason : o.status))
    expect(reasons).toEqual([
      'malformed',
      'encrypted',
      'no_text_layer',
      'unsupported_type',
      'too_large'
    ])

    const messages = new Set(outcomes.map((o) => (o.status === 'failed' ? o.message : '')))
    expect(messages.size).toBe(5)
  })

  it('does not crash the worker handler — it always answers', async () => {
    const hostile: [string, Uint8Array][] = [
      ['corrupt', corruptPdf()],
      ['not-a-pdf', notAPdf()],
      ['encrypted', buildPdf(['x'], { encrypted: true })],
      ['empty', new Uint8Array(0)],
      ['random bytes', new Uint8Array([0xff, 0x00, 0xfe, 0x01, 0x7f])]
    ]

    for (const [label, bytes] of hostile) {
      const response = await handleParseRequest({
        id: label,
        kind: 'pdf',
        filename: `${label}.pdf`,
        bytes
      })

      expect(response.id, label).toBe(label)
      expect('ok' in response && response.ok === false, label).toBe(true)
      if ('ok' in response && response.ok === false) {
        expect(response.reason, label).toBeTruthy()
        expect(response.message, label).toBeTruthy()
      }
    }

    const good = await handleParseRequest({
      id: 'good',
      kind: 'pdf',
      filename: 'good.pdf',
      bytes: buildPdf(['still working'])
    })
    expect('ok' in good && good.ok).toBe(true)
  })

  it('rejects an oversized file before reading a single byte', async () => {
    let read = false
    const outcome = await pipeline().ingest({
      candidate: { filename: 'huge.pdf', sizeBytes: MAX_FILE_BYTES + 1 },
      readBytes: async () => {
        read = true
        return new Uint8Array(0)
      }
    })

    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') expect(outcome.reason).toBe('too_large')

    expect(read).toBe(false)

    expect(repos.documents.list()).toHaveLength(0)
  })

  it('rejects unsupported types with a friendly message', async () => {
    for (const filename of ['a.docx', 'b.png', 'c.zip', 'noextension']) {
      const outcome = await ingest(filename, utf8('content'))
      expect(outcome.status).toBe('failed')
      if (outcome.status === 'failed') {
        expect(outcome.reason).toBe('unsupported_type')
        expect(outcome.message).toMatch(/PDF, Markdown/)
      }
    }
  })
})

describe('duplicate detection', () => {
  const bytes = (): Uint8Array => utf8('# Title\n\nThe same content every time.')

  it('detects a re-import by sha256 and asks rather than deciding', async () => {
    const first = await ingest('notes.md', bytes())
    expect(first.status).toBe('ready')

    const second = await ingest('notes-copy.md', bytes())

    expect(second.status).toBe('duplicate')
    if (second.status !== 'duplicate') return

    expect(second.existingDocumentId).toBe(first.status === 'ready' ? first.documentId : '')
    expect(second.filename).toBe('notes.md')
    expect(second.sha256).toBe(sha256(bytes()))

    expect(repos.documents.list()).toHaveLength(1)
  })

  it('link-existing returns the original and creates no second row', async () => {
    const first = await ingest('notes.md', bytes())
    const linked = await ingest('notes-copy.md', bytes(), { onDuplicate: 'link-existing' })

    expect(linked.status).toBe('ready')
    if (linked.status === 'ready' && first.status === 'ready') {
      expect(linked.documentId).toBe(first.documentId)
      expect(linked.chunks).toBeGreaterThan(0)
    }
    expect(repos.documents.list()).toHaveLength(1)
  })

  it('import-as-copy creates a genuinely independent second document', async () => {
    const first = await ingest('notes.md', bytes())
    const copy = await ingest('notes-copy.md', bytes(), { onDuplicate: 'import-as-copy' })

    expect(copy.status).toBe('ready')
    if (copy.status !== 'ready' || first.status !== 'ready') return

    expect(copy.documentId).not.toBe(first.documentId)
    expect(repos.documents.list()).toHaveLength(2)

    const all = repos.documents.findAllBySha256(sha256(bytes()))
    expect(all).toHaveLength(2)
    expect(new Set(all.map((d) => d.sha256)).size).toBe(1)

    expect(repos.chunks.listByDocument(copy.documentId).length).toBeGreaterThan(0)
    expect(repos.chunks.listByDocument(first.documentId).length).toBeGreaterThan(0)
  })

  it('NEVER dedupes across workspaces', async () => {
    await ingest('notes.md', bytes())

    new WorkspaceDirectory(db).create('ws-b', 'B')
    const other = new WorkspaceRepositories(db, 'ws-b')
    const otherPipeline = new DocumentPipeline({
      documents: other.documents,
      chunks: other.chunks,
      parse: (b, k) => parseDocument(b, k),
      newId
    })

    const outcome = await otherPipeline.ingest({
      candidate: { filename: 'notes.md', sizeBytes: bytes().byteLength },
      readBytes: async () => bytes()
    })

    expect(outcome.status).toBe('ready')
    expect(other.documents.list()).toHaveLength(1)
    expect(repos.documents.list()).toHaveLength(1)
    if (outcome.status === 'ready') {
      expect(repos.documents.find(outcome.documentId)).toBeUndefined()
    }
  })
})

describe('status lifecycle', () => {
  it('ends at ready for a good file and failed(reason) for a bad one', async () => {
    const good = await ingest('good.md', utf8('# Heading\n\nSome content here.'))
    expect(good.status).toBe('ready')
    expect(repos.documents.listByStatus('ready')).toHaveLength(1)
    expect(repos.documents.listByStatus('failed')).toHaveLength(0)

    await ingest('bad.pdf', corruptPdf())
    expect(repos.documents.listByStatus('failed')).toHaveLength(1)
    expect(repos.documents.listByStatus('parsing')).toHaveLength(0)
    expect(repos.documents.listByStatus('pending')).toHaveLength(0)
  })

  it('passes through parsing on the way', async () => {
    const seen: string[] = []
    const observing = pipeline({
      parse: async (bytes, kind) => {
        seen.push(repos.documents.list()[0]?.status ?? 'none')
        return parseDocument(bytes, kind)
      }
    })

    await observing.ingest({
      candidate: { filename: 'x.md', sizeBytes: 10 },
      readBytes: async () => utf8('# X\n\nbody')
    })

    expect(seen).toEqual(['parsing'])
    expect(repos.documents.list()[0]!.status).toBe('ready')
  })

  it('reparse clears the old chunks rather than duplicating them', async () => {
    const first = await ingest('doc.md', utf8('# One\n\nalpha bravo charlie'))
    if (first.status !== 'ready') throw new Error('setup failed')

    const before = repos.chunks.listByDocument(first.documentId).length
    const again = await pipeline().reparse(
      first.documentId,
      utf8('# Two\n\ndelta echo foxtrot'),
      'markdown'
    )

    expect(again.status).toBe('ready')
    const after = repos.chunks.listByDocument(first.documentId)
    expect(after.length).toBe(before)
    expect(after.map((c) => c.text).join(' ')).toContain('delta')
    expect(after.map((c) => c.text).join(' ')).not.toContain('alpha')
  })
})

describe('detection', () => {
  it('recognises the supported kinds by extension', () => {
    expect(detectKind({ filename: 'a.PDF', sizeBytes: 1 })).toBe('pdf')
    expect(detectKind({ filename: 'a.md', sizeBytes: 1 })).toBe('markdown')
    expect(detectKind({ filename: 'a.markdown', sizeBytes: 1 })).toBe('markdown')
    expect(detectKind({ filename: 'a.txt', sizeBytes: 1 })).toBe('text')
    expect(detectKind({ filename: 'a.docx', sizeBytes: 1 })).toBeUndefined()
  })

  it('falls back to the declared mime type', () => {
    expect(detectKind({ filename: 'download', sizeBytes: 1, mime: 'application/pdf' })).toBe('pdf')
    expect(
      detectKind({ filename: 'download', sizeBytes: 1, mime: 'text/plain; charset=utf-8' })
    ).toBe('text')
  })

  it('reports the wrong type before the wrong size', () => {
    expect(() => admit({ filename: 'big.exe', sizeBytes: 900 * 1024 * 1024 })).toThrow(
      /file type is not supported/
    )
  })
})

describe('FTS query escaping', () => {
  it('survives punctuation a user would actually type', () => {
    expect(toMatchQuery('C++ (v2)')).toBe('"C" OR "v2"')
    expect(toMatchQuery('"quoted"')).toBe('"quoted"')
    expect(toMatchQuery('   ')).toBe('')
  })

  it('does not throw on hostile input', async () => {
    const retriever = new Bm25Retriever(repos.chunks)
    for (const query of ['"', '*', 'a AND (', 'NEAR/', '']) {
      await expect(retriever.search(query)).resolves.toBeInstanceOf(Array)
    }
  })
})

describe('parsed text documents', () => {
  it('gives markdown and text a single citable page', async () => {
    const parsed: ParsedDocument = await parseDocument(utf8('# Title\n\nbody'), 'markdown')
    expect(parsed.pageCount).toBe(1)
    expect(parsed.pages).toEqual([{ pageNumber: 1, text: '# Title\n\nbody' }])

    const chunks = chunkDocument(parsed)
    expect(chunks.every((c) => c.pageFrom === 1 && c.pageTo === 1)).toBe(true)
  })

  it('normalises CRLF and strips a BOM', async () => {
    const parsed = await parseDocument(utf8('﻿# Title\r\n\r\nbody'), 'markdown')
    expect(parsed.pages[0]!.text).toBe('# Title\n\nbody')
  })
})
