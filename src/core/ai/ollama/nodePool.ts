import { readFileSync } from 'node:fs'
import { z } from 'zod'

export const nodeEntrySchema = z.object({
  url: z.string().url(),
  tps: z.number().nonnegative().default(0),
  location: z.string().optional(),
  organization: z.string().optional(),
  lastTested: z.string().nullable().optional()
})

export const nodeRegistrySchema = z.object({
  generatedAt: z.string().optional(),
  source: z.string().optional(),
  nodes: z.record(z.string(), z.array(nodeEntrySchema))
})

export type NodeEntry = z.infer<typeof nodeEntrySchema>
export type NodeRegistry = z.infer<typeof nodeRegistrySchema>

export function parseNodeRegistry(raw: unknown): NodeRegistry {
  return nodeRegistrySchema.parse(raw)
}

export function loadNodeRegistry(path: string): NodeRegistry {
  return parseNodeRegistry(JSON.parse(readFileSync(path, 'utf8')))
}

export const DEFAULT_UNHEALTHY_MS = 60_000

export interface NodePoolOptions {
  unhealthyMs?: number
  now?: () => number
}

export class NodePool {
  readonly #registry: NodeRegistry
  readonly #unhealthyMs: number
  readonly #now: () => number
  readonly #unhealthyUntil = new Map<string, number>()

  constructor(registry: NodeRegistry, options: NodePoolOptions = {}) {
    this.#registry = registry
    this.#unhealthyMs = options.unhealthyMs ?? DEFAULT_UNHEALTHY_MS
    this.#now = options.now ?? Date.now
  }

  models(): string[] {
    return Object.keys(this.#registry.nodes).sort()
  }

  nodesFor(model: string): NodeEntry[] {
    return this.#registry.nodes[model] ?? []
  }

  isHealthy(url: string): boolean {
    const until = this.#unhealthyUntil.get(url)
    return until === undefined || this.#now() >= until
  }

  markUnhealthy(url: string): void {
    this.#unhealthyUntil.set(url, this.#now() + this.#unhealthyMs)
  }

  markHealthy(url: string): void {
    this.#unhealthyUntil.delete(url)
  }

  candidates(model: string): NodeEntry[] {
    const all = this.nodesFor(model)
    const healthy = all.filter((node) => this.isHealthy(node.url))
    const byTps = (a: NodeEntry, b: NodeEntry): number => b.tps - a.tps

    if (healthy.length > 0) return [...healthy].sort(byTps)

    return [...all].sort((a, b) => {
      const left = this.#unhealthyUntil.get(a.url) ?? 0
      const right = this.#unhealthyUntil.get(b.url) ?? 0
      return left === right ? byTps(a, b) : left - right
    })
  }
}
