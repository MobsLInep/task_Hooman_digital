import type { ChunkRepository, ChunkSearchHit } from '../persistence'

export interface RetrievedChunk {
  chunkId: string
  documentId: string
  text: string
  ordinal: number
  pageFrom: number | null
  pageTo: number | null
  score: number
}

export interface Retriever {
  readonly id: string
  search(query: string, limit?: number): Promise<RetrievedChunk[]>
}

export function toMatchQuery(query: string): string {
  const terms = query
    .split(/[^\p{L}\p{N}_]+/u)
    .map((term) => term.trim())
    .filter(Boolean)

  if (terms.length === 0) return ''
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ')
}

export class Bm25Retriever implements Retriever {
  readonly id = 'sqlite-fts5-bm25'

  constructor(private readonly chunks: ChunkRepository) {}

  async search(query: string, limit = 20): Promise<RetrievedChunk[]> {
    const match = toMatchQuery(query)
    if (!match) return []

    const hits = this.chunks.search(match, limit)
    return hits.map((hit) => toRetrieved(hit))
  }
}

function toRetrieved(hit: ChunkSearchHit): RetrievedChunk {
  return {
    chunkId: hit.id,
    documentId: hit.documentId,
    text: hit.text,
    ordinal: hit.ordinal,
    pageFrom: hit.pageFrom,
    pageTo: hit.pageTo,
    score: -hit.score
  }
}
