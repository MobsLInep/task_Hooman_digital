import type { TokenCounter } from './types'

export class HeuristicTokenCounter implements TokenCounter {
  readonly id = 'heuristic-v1'

  count(text: string): number {
    if (!text) return 0

    let tokens = 0

    const cjk = text.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g)
    const cjkCount = cjk?.length ?? 0
    tokens += cjkCount

    const rest = cjkCount ? text.replace(/[぀-ヿ㐀-䶿一-鿿가-힯]/g, ' ') : text

    for (const word of rest.split(/\s+/)) {
      if (!word) continue

      const dense = /[^\p{L}]/u.test(word) ? 3 : 4
      tokens += Math.max(1, Math.ceil(word.length / dense))
    }

    return tokens
  }
}

export const defaultTokenCounter = new HeuristicTokenCounter()

export const PER_MESSAGE_OVERHEAD_TOKENS = 8

export interface DriftSample {
  estimate: number
  actual: number
  ratio: number
  model: string
}

export class DriftTracker {
  readonly #samples: DriftSample[] = []
  readonly #limit: number
  readonly #log: (line: string) => void

  constructor(options: { limit?: number; log?: (line: string) => void } = {}) {
    this.#limit = options.limit ?? 200
    this.#log = options.log ?? (() => {})
  }

  record(estimate: number, actual: number, model: string): DriftSample | undefined {
    if (!Number.isFinite(actual) || actual <= 0) return undefined

    const sample: DriftSample = { estimate, actual, ratio: estimate / actual, model }
    this.#samples.push(sample)
    if (this.#samples.length > this.#limit) this.#samples.shift()

    this.#log(
      `[tokens] drift model=${model} estimate=${estimate} actual=${actual} ` +
        `ratio=${sample.ratio.toFixed(3)}${sample.ratio < 0.9 ? ' UNDER-ESTIMATE' : ''}`
    )
    return sample
  }

  get samples(): readonly DriftSample[] {
    return this.#samples
  }

  meanRatio(): number | undefined {
    if (!this.#samples.length) return undefined
    return this.#samples.reduce((sum, s) => sum + s.ratio, 0) / this.#samples.length
  }

  worstUnderEstimate(): DriftSample | undefined {
    return this.#samples.reduce<DriftSample | undefined>(
      (worst, s) => (worst === undefined || s.ratio < worst.ratio ? s : worst),
      undefined
    )
  }
}
