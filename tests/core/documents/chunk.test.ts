import { describe, it, expect } from 'vitest'
import {
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  chunkDocument,
  hardSplit,
  type ParsedDocument
} from '@core/documents'
import { defaultTokenCounter } from '@core/context'

const count = (text: string): number => defaultTokenCounter.count(text)

function doc(pages: string[], kind: ParsedDocument['kind'] = 'markdown'): ParsedDocument {
  return {
    kind,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
    pageCount: pages.length
  }
}

const sentence = 'This is a sentence of ordinary prose with a reasonable number of words in it. '
const paragraph = (n: number): string => `Paragraph ${n}. ${sentence.repeat(6)}`

describe('boundary preference', () => {
  it('splits on markdown headings, keeping a section with its title', () => {
    const body = [
      '# Introduction',
      '',
      sentence.repeat(30),
      '',
      '## Methods',
      '',
      sentence.repeat(30),
      '',
      '## Results',
      '',
      sentence.repeat(30)
    ].join('\n')

    const chunks = chunkDocument(doc([body]))

    expect(chunks.length).toBeGreaterThanOrEqual(3)

    for (const heading of ['# Introduction', '## Methods', '## Results']) {
      const opensABlock = chunks.some((chunk) =>
        chunk.text.split('\n\n').some((block) => block.trim().startsWith(heading))
      )
      expect(opensABlock, `${heading} does not open a block`).toBe(true)
    }

    const methods = chunks.find((chunk) => chunk.text.includes('## Methods'))!
    expect(methods.text.indexOf('## Methods')).toBeLessThan(methods.text.length - 100)
  })

  it('splits on paragraph boundaries, never mid-paragraph, when it can', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => paragraph(i))
    const chunks = chunkDocument(doc([paragraphs.join('\n\n')]))

    expect(chunks.length).toBeGreaterThan(1)
    for (const [index, chunk] of chunks.entries()) {
      const parts = chunk.text.split('\n\n').map((part) => part.trim())

      const body = index === 0 ? parts : parts.slice(1)
      for (const part of body) {
        expect(part).toMatch(/^Paragraph \d+\./)
        expect(part.endsWith('.')).toBe(true)
      }

      if (index > 0) {
        expect(parts[0]).toMatch(/^[A-Z]/)
        expect(parts[0]!.endsWith('.')).toBe(true)
      }
    }
  })

  it('falls back to a hard split only for a single oversized block', () => {
    const giant = sentence.repeat(400)
    const chunks = chunkDocument(doc([giant]))

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.tokens).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS * 1.5)
    }

    for (const chunk of chunks) expect(chunk.text.trim()).toMatch(/^[A-Z]/)
  })

  it('splits on words only when there is no punctuation at all', () => {
    const noPunctuation = 'alpha bravo charlie delta echo foxtrot golf hotel '.repeat(300)
    const pieces = hardSplit(noPunctuation, CHUNK_TARGET_TOKENS, defaultTokenCounter)

    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(count(piece)).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS)

      expect(piece).toMatch(/^[a-z]+/)
      expect(piece).toMatch(/[a-z]+$/)
    }

    expect(pieces.join(' ').replace(/\s+/g, ' ').trim()).toBe(
      noPunctuation.replace(/\s+/g, ' ').trim()
    )
  })
})

describe('size and overlap', () => {
  it('targets ~800 tokens', () => {
    const chunks = chunkDocument(
      doc([Array.from({ length: 40 }, (_, i) => paragraph(i)).join('\n\n')])
    )

    expect(chunks.length).toBeGreaterThan(2)

    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.tokens).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS + CHUNK_OVERLAP_TOKENS)
      expect(chunk.tokens).toBeGreaterThan(CHUNK_TARGET_TOKENS / 3)
    }
  })

  it('overlaps consecutive chunks so a boundary-spanning passage stays findable', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => paragraph(i))
    const chunks = chunkDocument(doc([paragraphs.join('\n\n')]))

    expect(chunks.length).toBeGreaterThan(1)

    for (let i = 1; i < chunks.length; i++) {
      const opening = chunks[i]!.text.slice(0, 60)
      expect(chunks[i - 1]!.text, `chunks ${i - 1} -> ${i} share no context`).toContain(opening)
    }

    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.text.trim()).toMatch(/^[A-Z]/)
    }
  })

  it('terminates instead of looping when one block exceeds the overlap window', () => {
    const chunks = chunkDocument(
      doc([Array.from({ length: 8 }, (_, i) => paragraph(i)).join('\n\n')]),
      {
        targetTokens: 120,
        overlapTokens: 100
      }
    )

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBeLessThan(200)
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i))
  })
})

describe('page ranges', () => {
  it('records the true span of a chunk crossing a page break', () => {
    const chunks = chunkDocument(
      doc(['short page one text.', 'short page two text.', 'short page three text.'], 'pdf')
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.pageFrom).toBe(1)
    expect(chunks[0]!.pageTo).toBe(3)
  })

  it('keeps a chunk on one page when the page is large enough to fill it', () => {
    const big = Array.from({ length: 20 }, (_, i) => paragraph(i)).join('\n\n')
    const chunks = chunkDocument(doc([big, big], 'pdf'))

    const spanning = chunks.filter((chunk) => chunk.pageFrom !== chunk.pageTo)
    expect(spanning.length).toBeLessThanOrEqual(1)
    expect(chunks.some((chunk) => chunk.pageFrom === 1 && chunk.pageTo === 1)).toBe(true)
    expect(chunks.some((chunk) => chunk.pageFrom === 2 && chunk.pageTo === 2)).toBe(true)
  })

  it('always populates both page fields, so every chunk is citable', () => {
    for (const parsed of [doc(['a', 'b', 'c'], 'pdf'), doc(['# H\n\nbody'], 'markdown')]) {
      for (const chunk of chunkDocument(parsed)) {
        expect(Number.isInteger(chunk.pageFrom)).toBe(true)
        expect(Number.isInteger(chunk.pageTo)).toBe(true)
        expect(chunk.pageFrom).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('edge cases', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkDocument(doc(['']))).toEqual([])
    expect(chunkDocument(doc(['   \n\n  \t ']))).toEqual([])
    expect(chunkDocument({ kind: 'pdf', pages: [], pageCount: 0 })).toEqual([])
  })

  it('produces one chunk for a short document', () => {
    const chunks = chunkDocument(doc(['# Title\n\nA short note.']))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text).toBe('# Title\n\nA short note.')
    expect(chunks[0]!.ordinal).toBe(0)
  })

  it('reports token counts that match the counter', () => {
    for (const chunk of chunkDocument(doc([paragraph(1)]))) {
      expect(Math.abs(chunk.tokens - count(chunk.text))).toBeLessThanOrEqual(4)
    }
  })
})
