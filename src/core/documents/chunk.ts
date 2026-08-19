import { defaultTokenCounter } from '../context/tokens'
import type { TokenCounter } from '../context/types'
import {
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  type DocumentChunk,
  type ParsedDocument
} from './types'

export interface ChunkOptions {
  targetTokens?: number
  overlapTokens?: number
  counter?: TokenCounter
}

interface Block {
  text: string
  tokens: number
  page: number
  isHeading: boolean
}

const HEADING = /^ {0,3}#{1,6}\s+\S/

export function chunkDocument(
  document: ParsedDocument,
  options: ChunkOptions = {}
): DocumentChunk[] {
  const counter = options.counter ?? defaultTokenCounter
  const target = options.targetTokens ?? CHUNK_TARGET_TOKENS
  const overlap = Math.min(options.overlapTokens ?? CHUNK_OVERLAP_TOKENS, Math.floor(target / 2))

  const blocks = toBlocks(document, counter, target)
  if (blocks.length === 0) return []

  const chunks: DocumentChunk[] = []
  let current: Block[] = []
  let currentTokens = 0

  const flush = (): void => {
    if (current.length === 0) return

    const text = current
      .map((block) => block.text)
      .join('\n\n')
      .trim()
    if (text) {
      chunks.push({
        ordinal: chunks.length,
        text,
        tokens: currentTokens,
        pageFrom: Math.min(...current.map((block) => block.page)),
        pageTo: Math.max(...current.map((block) => block.page))
      })
    }

    let carried: Block[] = []
    let carriedTokens = 0
    for (let i = current.length - 1; i >= 0; i--) {
      const block = current[i]!
      if (carriedTokens + block.tokens > overlap) break
      carried.unshift(block)
      carriedTokens += block.tokens
    }

    if (carried.length === current.length && current.length > 0) {
      carriedTokens -= carried[0]!.tokens
      carried.shift()
    }

    if (carried.length === 0 && current.length > 0) {
      const last = current[current.length - 1]!
      const tail = sentenceTail(last.text, overlap, counter)
      if (tail && tail.length < last.text.length) {
        carried = [{ text: tail, tokens: counter.count(tail), page: last.page, isHeading: false }]
        carriedTokens = carried[0]!.tokens
      }
    }

    current = carried
    currentTokens = carriedTokens
  }

  for (const block of blocks) {
    const headingBreak = block.isHeading && currentTokens >= target / 2

    if (currentTokens > 0 && (headingBreak || currentTokens + block.tokens > target)) {
      flush()
    }

    current.push(block)
    currentTokens += block.tokens
  }

  if (current.length > 0) {
    const text = current
      .map((block) => block.text)
      .join('\n\n')
      .trim()
    if (text) {
      chunks.push({
        ordinal: chunks.length,
        text,
        tokens: currentTokens,
        pageFrom: Math.min(...current.map((block) => block.page)),
        pageTo: Math.max(...current.map((block) => block.page))
      })
    }
  }

  return chunks
}

export function sentenceTail(text: string, budget: number, counter: TokenCounter): string {
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g)
  if (!sentences || sentences.length <= 1) return ''

  let tail = ''
  for (let i = sentences.length - 1; i >= 0; i--) {
    const attempt = sentences[i]! + tail
    if (counter.count(attempt) > budget) break
    tail = attempt
  }
  return tail.trim()
}

function toBlocks(document: ParsedDocument, counter: TokenCounter, target: number): Block[] {
  const blocks: Block[] = []

  for (const page of document.pages) {
    for (const raw of splitPage(page.text)) {
      const text = raw.trim()
      if (!text) continue

      const tokens = counter.count(text)
      const isHeading = HEADING.test(text)

      if (tokens <= target) {
        blocks.push({ text, tokens, page: page.pageNumber, isHeading })
        continue
      }

      for (const piece of hardSplit(text, target, counter)) {
        blocks.push({
          text: piece,
          tokens: counter.count(piece),
          page: page.pageNumber,
          isHeading: isHeading && blocks.length === 0
        })
      }
    }
  }

  return blocks
}

function splitPage(text: string): string[] {
  const out: string[] = []
  let section: string[] = []

  const pushSection = (): void => {
    if (section.length === 0) return
    const body = section.join('\n')
    for (const paragraph of body.split(/\n\s*\n/)) {
      if (paragraph.trim()) out.push(paragraph)
    }
    section = []
  }

  for (const line of text.split('\n')) {
    if (HEADING.test(line)) {
      pushSection()
      section.push(line)
      continue
    }
    section.push(line)
  }
  pushSection()

  return out
}

export function hardSplit(text: string, target: number, counter: TokenCounter): string[] {
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [text]
  const pieces: string[] = []
  let buffer = ''

  const flush = (): void => {
    if (buffer.trim()) pieces.push(buffer.trim())
    buffer = ''
  }

  for (const sentence of sentences) {
    if (counter.count(sentence) > target) {
      flush()
      pieces.push(...splitOnWords(sentence, target, counter))
      continue
    }
    if (buffer && counter.count(buffer + sentence) > target) flush()
    buffer += sentence
  }
  flush()

  return pieces.length ? pieces : [text]
}

function splitOnWords(text: string, target: number, counter: TokenCounter): string[] {
  const words = text.split(/(\s+)/)
  const pieces: string[] = []
  let buffer = ''

  for (const word of words) {
    if (buffer && counter.count(buffer + word) > target) {
      pieces.push(buffer.trim())
      buffer = ''
    }
    buffer += word
  }
  if (buffer.trim()) pieces.push(buffer.trim())

  return pieces
}
