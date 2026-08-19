import type { ChatMessage } from '../ai/types'
import {
  renderCandidate,
  RETRIEVED_HEADER,
  SUMMARY_HEADER,
  UNTRUSTED_CONTENT_POLICY
} from './render'
import { defaultTokenCounter, PER_MESSAGE_OVERHEAD_TOKENS } from './tokens'
import {
  ContextBudgetError,
  TIER_CAPS,
  TIER_NAMES,
  type AssembleContextInput,
  type ContextCandidate,
  type ContextPackage,
  type ExcludedItem,
  type ExclusionReason,
  type IncludedItem,
  type LadderEvent,
  type Tier,
  type TierReport,
  type TokenCounter
} from './types'

export function assembleContext(input: AssembleContextInput): ContextPackage {
  const counter: TokenCounter = input.counter ?? defaultTokenCounter
  const { modelLimit, reservedOutput, safetyMargin } = input.budget
  const usable = modelLimit - reservedOutput - safetyMargin

  const included: IncludedItem[] = []
  const excluded: ExcludedItem[] = []
  const ladder: LadderEvent[] = []

  const renderedText = new Map<string, string>()

  const cost = (candidate: ContextCandidate, text?: string): number =>
    counter.count(renderCandidate(candidate, text)) +
    (isOwnMessage(candidate) ? PER_MESSAGE_OVERHEAD_TOKENS : 0)

  const policyTokens = counter.count(UNTRUSTED_CONTENT_POLICY)
  const queryTokens = counter.count(input.query)
  const scaffoldTokens = counter.count(SUMMARY_HEADER) + counter.count(RETRIEVED_HEADER)

  const fixedMessageOverhead = 4 * PER_MESSAGE_OVERHEAD_TOKENS
  const overheadTokens = queryTokens + scaffoldTokens + fixedMessageOverhead

  if (usable <= 0) {
    throw new ContextBudgetError(
      `Budget leaves no usable room: modelLimit ${modelLimit} - reservedOutput ` +
        `${reservedOutput} - safetyMargin ${safetyMargin} = ${usable}`,
      { usable, required: policyTokens, itemIds: [] }
    )
  }

  const byTier = groupByTier(input.candidates)

  const t0 = byTier[0]
  const t0Tokens = t0.reduce((sum, candidate) => sum + cost(candidate), 0) + policyTokens

  if (t0Tokens + overheadTokens > usable) {
    throw new ContextBudgetError(
      `Tier 0 (system + workspace instructions) needs ${t0Tokens} tokens, plus ` +
        `${overheadTokens} unavoidable tokens for the query and scaffolding, but only ` +
        `${usable} are usable. T0 is never truncated or dropped; reduce the system ` +
        `prompt, the workspace instructions, or reservedOutput/safetyMargin.`,
      { usable, required: t0Tokens + overheadTokens, itemIds: t0.map((c) => c.id) }
    )
  }

  for (const candidate of t0) {
    included.push(
      toIncluded(candidate, 0, cost(candidate), rankOf(candidate, 0, input.candidates), false)
    )
    renderedText.set(candidate.id, candidate.text)
  }

  included.push({
    id: POLICY_ITEM_ID,
    kind: 'system',
    tier: 0,
    tokens: policyTokens,
    rank: 0,
    truncated: false,
    source: { type: 'system', label: 'untrusted content policy' }
  })

  const pool = usable - t0Tokens - overheadTokens
  const reports: TierReport[] = [
    {
      tier: 0,
      name: TIER_NAMES[0],
      cap: t0Tokens,
      allocated: t0Tokens,
      used: t0Tokens,
      cascadedIn: 0,
      cascadedOut: 0,
      includedIds: [...t0.map((c) => c.id), POLICY_ITEM_ID],
      excludedIds: []
    }
  ]

  let cascade = 0
  const summaries = byTier[4]

  for (const tier of [1, 2, 3, 4] as const) {
    const cap = Math.floor(pool * TIER_CAPS[tier])
    const allocated = cap + cascade
    const ranked = rankTier(byTier[tier], tier, input.candidates)

    let used = 0
    const tierIncluded: string[] = []
    const tierExcluded: string[] = []
    const overflow: ContextCandidate[] = []

    for (const { candidate, rank } of ranked) {
      const tokens = cost(candidate)
      if (!candidate.text.trim()) {
        excluded.push(toExcluded(candidate, tier, tokens, 'empty_text', 'candidate text was empty'))
        tierExcluded.push(candidate.id)
        continue
      }
      if (used + tokens <= allocated) {
        used += tokens
        included.push(toIncluded(candidate, tier, tokens, rank, false))
        renderedText.set(candidate.id, candidate.text)
        tierIncluded.push(candidate.id)
      } else {
        overflow.push(candidate)
      }
    }

    if (overflow.length) {
      ladder.push({
        step: 1,
        tier,
        action: `dropped ${overflow.length} whole item(s) that did not fit the tier allocation`,
        itemIds: overflow.map((c) => c.id),
        tokensReclaimed: 0
      })
    }

    const stillOut: ContextCandidate[] = []
    for (const candidate of overflow) {
      const room = allocated - used
      if (candidate.kind !== 'doc_chunk' || room <= 0) {
        stillOut.push(candidate)
        continue
      }

      const truncated = truncateAtParagraph(candidate, room, cost)
      if (!truncated) {
        stillOut.push(candidate)
        continue
      }

      used += truncated.tokens
      included.push(
        toIncluded(
          candidate,
          tier,
          truncated.tokens,
          rankOf(candidate, tier, input.candidates),
          true
        )
      )
      renderedText.set(candidate.id, truncated.text)
      tierIncluded.push(candidate.id)
      ladder.push({
        step: 2,
        tier,
        action: `truncated at a paragraph boundary to fit ${truncated.tokens} tokens`,
        itemIds: [candidate.id],
        tokensReclaimed: truncated.tokens
      })
    }

    let remainingOut = stillOut
    if (tier === 2 && stillOut.length) {
      const swap = replaceOldestWithSummaries({
        includedIds: tierIncluded,
        candidates: byTier[2],
        summaries,
        cost
      })

      if (swap.freed > 0) {
        for (const replaced of swap.replaced) {
          const at = included.findIndex((item) => item.id === replaced.turn.id)
          if (at >= 0) included.splice(at, 1)
          const at2 = tierIncluded.indexOf(replaced.turn.id)
          if (at2 >= 0) tierIncluded.splice(at2, 1)

          excluded.push(
            toExcluded(
              replaced.turn,
              2,
              replaced.turnTokens,
              'replaced_by_summary',
              `verbatim turn replaced by summary ${replaced.summary.id} to free space`
            )
          )
          tierExcluded.push(replaced.turn.id)

          used -= replaced.turnTokens
          used += replaced.summaryTokens
          renderedText.delete(replaced.turn.id)
          included.push(
            toIncluded(
              replaced.summary,
              2,
              replaced.summaryTokens,
              rankOf(replaced.summary, 2, input.candidates),
              false
            )
          )
          renderedText.set(replaced.summary.id, replaced.summary.text)
          tierIncluded.push(replaced.summary.id)
        }

        ladder.push({
          step: 3,
          tier: 2,
          action: `replaced ${swap.replaced.length} oldest verbatim turn(s) with their summary`,
          itemIds: swap.replaced.map((r) => r.turn.id),
          tokensReclaimed: swap.freed
        })

        const retried: ContextCandidate[] = []
        for (const candidate of stillOut) {
          const tokens = cost(candidate)
          if (used + tokens <= allocated) {
            used += tokens
            included.push(
              toIncluded(candidate, tier, tokens, rankOf(candidate, tier, input.candidates), false)
            )
            renderedText.set(candidate.id, candidate.text)
            tierIncluded.push(candidate.id)
          } else {
            retried.push(candidate)
          }
        }
        remainingOut = retried
      }
    }

    for (const candidate of remainingOut) {
      excluded.push(
        toExcluded(
          candidate,
          tier,
          cost(candidate),
          candidate.kind === 'doc_chunk' && allocated - used > 0
            ? 'no_paragraph_fits'
            : 'tier_allocation_exhausted',
          candidate.kind === 'doc_chunk' && allocated - used > 0
            ? `no whole paragraph fits in the ${allocated - used} tokens left in tier ${tier}`
            : `tier ${tier} allocation of ${allocated} tokens was exhausted`
        )
      )
      tierExcluded.push(candidate.id)
    }

    const cascadedOut = Math.max(0, allocated - used)
    reports.push({
      tier,
      name: TIER_NAMES[tier],
      cap,
      allocated,
      used,
      cascadedIn: cascade,
      cascadedOut,
      includedIds: tierIncluded,
      excludedIds: tierExcluded
    })
    cascade = cascadedOut
  }

  let total = included.reduce((sum, item) => sum + item.tokens, 0) + overheadTokens
  if (total > usable) {
    const t4 = included.filter((item) => item.tier === 4)
    if (t4.length) {
      const reclaimed = t4.reduce((sum, item) => sum + item.tokens, 0)
      for (const item of t4) {
        const at = included.findIndex((i) => i.id === item.id)
        if (at >= 0) included.splice(at, 1)
        renderedText.delete(item.id)
        const candidate = input.candidates.find((c) => c.id === item.id)
        if (candidate) {
          excluded.push(
            toExcluded(
              candidate,
              4,
              item.tokens,
              'tier_dropped_t4',
              'tier 4 dropped entirely: the package still exceeded the usable budget'
            )
          )
        }
      }
      const report4 = reports.find((r) => r.tier === 4)
      if (report4) {
        report4.used = 0
        report4.excludedIds = [...report4.excludedIds, ...t4.map((i) => i.id)]
        report4.includedIds = []
      }
      ladder.push({
        step: 4,
        tier: 4,
        action: 'dropped tier 4 (conversation summaries) entirely',
        itemIds: t4.map((i) => i.id),
        tokensReclaimed: reclaimed
      })
      total -= reclaimed
    }
  }

  return {
    messages: renderMessages(input, included, renderedText),
    report: {
      budget: { ...input.budget, usable },
      tiers: reports,
      included,
      excluded,
      ladder,
      overhead: overheadTokens,
      total,
      headroom: usable - total,
      counterId: counter.id
    }
  }
}

function isOwnMessage(candidate: ContextCandidate): boolean {
  return candidate.kind === 'recent_message' || candidate.kind === 'tool_result'
}

export const POLICY_ITEM_ID = '__untrusted_content_policy__'

export function tierOf(candidate: ContextCandidate): Tier {
  if (candidate.kind === 'system' || candidate.kind === 'workspace_instruction') return 0
  if (candidate.pinned) return 1
  if (candidate.kind === 'recent_message' || candidate.kind === 'tool_result') return 2
  if (candidate.kind === 'doc_chunk' || candidate.kind === 'note') return 3
  return 4
}

function groupByTier(candidates: readonly ContextCandidate[]): Record<Tier, ContextCandidate[]> {
  const groups: Record<Tier, ContextCandidate[]> = { 0: [], 1: [], 2: [], 3: [], 4: [] }
  for (const candidate of candidates) groups[tierOf(candidate)].push(candidate)
  return groups
}

export function scoreOf(candidate: ContextCandidate, maxRecencyRank: number): number {
  const similarity = clamp01(candidate.similarity ?? 0)
  const recency =
    candidate.recencyRank === undefined
      ? 0
      : maxRecencyRank <= 0
        ? 1
        : clamp01(1 - candidate.recencyRank / maxRecencyRank)
  return 0.7 * similarity + 0.3 * recency
}

function maxRank(candidates: readonly ContextCandidate[]): number {
  return candidates.reduce((max, c) => Math.max(max, c.recencyRank ?? 0), 0)
}

function rankOf(
  candidate: ContextCandidate,
  _tier: Tier,
  all: readonly ContextCandidate[]
): number {
  return scoreOf(candidate, maxRank(all))
}

function rankTier(
  candidates: readonly ContextCandidate[],
  tier: Tier,
  all: readonly ContextCandidate[]
): { candidate: ContextCandidate; rank: number }[] {
  const ceiling = maxRank(all)
  const scored = candidates.map((candidate) => ({
    candidate,
    rank: scoreOf(candidate, ceiling)
  }))

  scored.sort((a, b) => {
    if (tier === 2) {
      const left = a.candidate.recencyRank ?? Number.MAX_SAFE_INTEGER
      const right = b.candidate.recencyRank ?? Number.MAX_SAFE_INTEGER
      if (left !== right) return left - right
    }
    if (b.rank !== a.rank) return b.rank - a.rank
    return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0
  })

  return scored
}

const TRUNCATION_MARKER = '[truncated]'

export function truncateAtParagraph(
  candidate: ContextCandidate,
  room: number,
  cost: (candidate: ContextCandidate, text?: string) => number
): { text: string; tokens: number } | undefined {
  const paragraphs = candidate.text.split(/\n\s*\n/).filter((p) => p.trim())
  if (paragraphs.length === 0) return undefined

  let kept = ''
  let tokens = 0

  for (const paragraph of paragraphs) {
    const attempt = kept ? `${kept}\n\n${paragraph}` : paragraph
    const withMarker = `${attempt}\n\n${TRUNCATION_MARKER}`
    const attemptTokens = cost(candidate, withMarker)
    if (attemptTokens > room) break
    kept = attempt
    tokens = attemptTokens
  }

  if (!kept || kept === candidate.text) return undefined

  return { text: `${kept}\n\n${TRUNCATION_MARKER}`, tokens }
}

interface SummarySwap {
  turn: ContextCandidate
  turnTokens: number
  summary: ContextCandidate
  summaryTokens: number
}

function replaceOldestWithSummaries(args: {
  includedIds: readonly string[]
  candidates: readonly ContextCandidate[]
  summaries: readonly ContextCandidate[]
  cost: (candidate: ContextCandidate, text?: string) => number
}): { replaced: SummarySwap[]; freed: number } {
  const included = args.candidates
    .filter((candidate) => args.includedIds.includes(candidate.id))
    .sort((a, b) => (b.recencyRank ?? 0) - (a.recencyRank ?? 0))

  const replaced: SummarySwap[] = []
  const usedSummaries = new Set<string>()
  let freed = 0

  for (const turn of included) {
    const summary = args.summaries.find(
      (s) => !usedSummaries.has(s.id) && s.summarizes?.includes(turn.id)
    )
    if (!summary) continue

    const turnTokens = args.cost(turn)
    const summaryTokens = args.cost(summary)
    if (summaryTokens >= turnTokens) continue

    usedSummaries.add(summary.id)
    replaced.push({ turn, turnTokens, summary, summaryTokens })
    freed += turnTokens - summaryTokens
  }

  return { replaced, freed }
}

function toIncluded(
  candidate: ContextCandidate,
  tier: Tier,
  tokens: number,
  rank: number,
  truncated: boolean
): IncludedItem {
  return {
    id: candidate.id,
    kind: candidate.kind,
    tier,
    tokens,
    rank: Number(rank.toFixed(6)),
    truncated,
    source: candidate.source
  }
}

function toExcluded(
  candidate: ContextCandidate,
  tier: Tier,
  tokens: number,
  reason: ExclusionReason,
  detail: string
): ExcludedItem {
  return { id: candidate.id, kind: candidate.kind, tier, tokens, reason, detail }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function renderMessages(
  input: AssembleContextInput,
  included: readonly IncludedItem[],
  renderedText: ReadonlyMap<string, string>
): ChatMessage[] {
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]))
  const textOf = (id: string): string => renderedText.get(id) ?? byId.get(id)!.text
  const pick = (tier: Tier): IncludedItem[] => included.filter((item) => item.tier === tier)

  const systemParts = pick(0)
    .filter((item) => item.id !== POLICY_ITEM_ID)
    .map((item) => textOf(item.id))
  systemParts.push(UNTRUSTED_CONTENT_POLICY)

  const messages: ChatMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }]

  const summaries = pick(4)
  if (summaries.length) {
    messages.push({
      role: 'user',
      content: [SUMMARY_HEADER, ...summaries.map((item) => textOf(item.id))].join('\n\n')
    })
  }

  const turns = [...pick(2)].sort((a, b) => {
    const left = byId.get(a.id)!.recencyRank ?? 0
    const right = byId.get(b.id)!.recencyRank ?? 0
    return right - left
  })
  for (const item of turns) {
    const candidate = byId.get(item.id)!
    messages.push({
      role: candidate.kind === 'tool_result' ? 'user' : inferRole(candidate),
      content: textOf(item.id)
    })
  }

  const retrieved = [...pick(1), ...pick(3)]
  if (retrieved.length) {
    const rendered = retrieved.map((item) => renderCandidate(byId.get(item.id)!, textOf(item.id)))

    messages.push({
      role: 'user',
      content: [RETRIEVED_HEADER, '', ...rendered].join('\n')
    })
  }

  messages.push({ role: 'user', content: input.query })
  return messages
}

function inferRole(candidate: ContextCandidate): 'user' | 'assistant' {
  return /^assistant:/i.test(candidate.text) ? 'assistant' : 'user'
}
