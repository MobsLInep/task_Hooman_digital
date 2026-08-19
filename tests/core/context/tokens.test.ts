import { describe, it, expect } from 'vitest'
import {
  assembleContext,
  DriftTracker,
  HeuristicTokenCounter,
  defaultTokenCounter,
  type ContextCandidate,
  type TokenCounter
} from '@core/context'

describe('HeuristicTokenCounter', () => {
  const counter = new HeuristicTokenCounter()

  it('is deterministic and additive-ish', () => {
    expect(counter.count('hello world')).toBe(counter.count('hello world'))
    expect(counter.count('')).toBe(0)
    expect(counter.count('hello')).toBeGreaterThan(0)
  })

  it('grows with text length', () => {
    const short = counter.count('one two three')
    const long = counter.count('one two three '.repeat(20))
    expect(long).toBeGreaterThan(short * 10)
  })

  it('does not badly under-count CJK, where length/4 would be 4x low', () => {
    const cjk = '这是一段中文文本用于测试分词器的行为'

    expect(counter.count(cjk)).toBeGreaterThanOrEqual(cjk.length)
  })

  it('counts punctuation-dense text more heavily than prose of the same length', () => {
    const prose = 'alpha bravo charlie delta echo'
    const dense = '{"a":1,"b":2,"c":3,"d":4,"e":5}'
    expect(counter.count(dense)).toBeGreaterThan(counter.count(prose))
  })

  it('is the exported default', () => {
    expect(defaultTokenCounter.id).toBe('heuristic-v1')
  })
})

describe('DriftTracker', () => {
  it('records the estimate/actual ratio of a real call', () => {
    const tracker = new DriftTracker()
    tracker.record(100, 125, 'llama3.2:3b')

    expect(tracker.samples).toHaveLength(1)
    expect(tracker.samples[0]!.ratio).toBeCloseTo(0.8, 5)
    expect(tracker.meanRatio()).toBeCloseTo(0.8, 5)
  })

  it('ignores a call where the node reported no usage', () => {
    const tracker = new DriftTracker()
    expect(tracker.record(100, 0, 'm')).toBeUndefined()
    expect(tracker.record(100, Number.NaN, 'm')).toBeUndefined()
    expect(tracker.samples).toHaveLength(0)
    expect(tracker.meanRatio()).toBeUndefined()
  })

  it('flags under-estimates, which are the dangerous direction', () => {
    const lines: string[] = []
    const tracker = new DriftTracker({ log: (line) => lines.push(line) })

    tracker.record(80, 200, 'llama3.2:3b')
    tracker.record(210, 200, 'llama3.2:3b')

    expect(lines[0]).toContain('UNDER-ESTIMATE')
    expect(lines[1]).not.toContain('UNDER-ESTIMATE')
    expect(tracker.worstUnderEstimate()!.ratio).toBeCloseTo(0.4, 5)
  })

  it('keeps only the most recent samples', () => {
    const tracker = new DriftTracker({ limit: 3 })
    for (let i = 1; i <= 10; i++) tracker.record(i, 10, 'm')
    expect(tracker.samples).toHaveLength(3)
    expect(tracker.samples.map((s) => s.estimate)).toEqual([8, 9, 10])
  })
})

describe('injected TokenCounter', () => {
  const candidates: ContextCandidate[] = [
    {
      id: 'sys',
      kind: 'system',
      text: 'be brief',
      tokens: 2,
      pinned: false,
      source: { type: 'system', label: 'system' }
    },
    {
      id: 'c1',
      kind: 'doc_chunk',
      text: 'some retrieved text',
      tokens: 4,
      pinned: false,
      similarity: 1,
      source: { type: 'document', docId: 'd1', filename: 'a.pdf', chunkOrdinal: 0 }
    }
  ]

  it('is used instead of the default, and named in the report', () => {
    const everyTextCostsTen: TokenCounter = { id: 'fixed-10', count: () => 10 }

    const result = assembleContext({
      budget: { modelLimit: 1000, reservedOutput: 0, safetyMargin: 0 },
      candidates,
      query: 'q',
      counter: everyTextCostsTen
    })

    expect(result.report.counterId).toBe('fixed-10')
    for (const item of result.report.included) expect(item.tokens).toBe(10)
  })

  it('keeps assembly within budget even for a pessimistic counter', () => {
    const expensive: TokenCounter = { id: 'x10', count: (t) => defaultTokenCounter.count(t) * 10 }

    const result = assembleContext({
      budget: { modelLimit: 6000, reservedOutput: 0, safetyMargin: 0 },
      candidates,
      query: 'q',
      counter: expensive
    })

    expect(result.report.total).toBeLessThanOrEqual(result.report.budget.usable)
  })
})
