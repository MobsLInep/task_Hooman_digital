import type { ChatMessage } from '../ai/types'

export type ContextKind =
  | 'system'
  | 'workspace_instruction'
  | 'pinned_note'
  | 'recent_message'
  | 'summary'
  | 'doc_chunk'
  | 'note'
  | 'tool_result'

export type Provenance =
  | {
      type: 'document'
      docId: string
      filename: string
      chunkOrdinal: number
      pageFrom?: number | null
      pageTo?: number | null
    }
  | { type: 'message'; messageId: string; conversationId: string }
  | { type: 'note'; noteId: string; title: string }
  | { type: 'system'; label: string }

export interface ContextCandidate {
  id: string
  kind: ContextKind
  text: string
  tokens: number
  recencyRank?: number
  similarity?: number
  pinned: boolean
  source: Provenance
  summarizes?: string[]
}

export interface ContextBudget {
  modelLimit: number
  reservedOutput: number
  safetyMargin: number
}

export interface AssembleContextInput {
  budget: ContextBudget
  candidates: ContextCandidate[]
  query: string
  counter?: TokenCounter
}

export interface TokenCounter {
  readonly id: string
  count(text: string): number
}

export const TIERS = [0, 1, 2, 3, 4] as const
export type Tier = (typeof TIERS)[number]

export const TIER_NAMES: Record<Tier, string> = {
  0: 'system + workspace instructions',
  1: 'pinned items',
  2: 'recent turns verbatim',
  3: 'retrieved doc chunks',
  4: 'conversation summaries'
}

export const TIER_CAPS: Record<Exclude<Tier, 0>, number> = {
  1: 0.2,
  2: 0.35,
  3: 0.3,
  4: 0.15
}

export type ExclusionReason =
  | 'tier_allocation_exhausted'
  | 'no_paragraph_fits'
  | 'replaced_by_summary'
  | 'tier_dropped_t4'
  | 'empty_text'

export interface IncludedItem {
  id: string
  kind: ContextKind
  tier: Tier
  tokens: number
  rank: number
  truncated: boolean
  source: Provenance
}

export interface ExcludedItem {
  id: string
  kind: ContextKind
  tier: Tier
  tokens: number
  reason: ExclusionReason
  detail: string
}

export interface TierReport {
  tier: Tier
  name: string
  cap: number
  allocated: number
  used: number
  cascadedIn: number
  cascadedOut: number
  includedIds: string[]
  excludedIds: string[]
}

export interface LadderEvent {
  step: 1 | 2 | 3 | 4
  tier: Tier
  action: string
  itemIds: string[]
  tokensReclaimed: number
}

export interface ContextReport {
  budget: ContextBudget & { usable: number }
  tiers: TierReport[]
  included: IncludedItem[]
  excluded: ExcludedItem[]
  ladder: LadderEvent[]
  overhead: number
  total: number
  headroom: number
  counterId: string
}

export interface ContextPackage {
  messages: ChatMessage[]
  report: ContextReport
}

export class ContextBudgetError extends Error {
  constructor(
    message: string,
    readonly detail: { usable: number; required: number; itemIds: string[] }
  ) {
    super(message)
    this.name = 'ContextBudgetError'
  }
}
