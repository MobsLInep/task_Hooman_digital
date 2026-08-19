import { z } from 'zod'
import type { AnyTool, Tool } from './types'

export class ToolRegistry {
  readonly #tools = new Map<string, AnyTool>()

  register<A, R>(tool: Tool<A, R>): this {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`)
    }
    if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
      throw new Error(`Tool name "${tool.name}" must be snake_case, starting with a letter`)
    }
    this.#tools.set(tool.name, tool as unknown as AnyTool)
    return this
  }

  registerAll(tools: readonly AnyTool[]): this {
    for (const tool of tools) this.register(tool)
    return this
  }

  get(name: string): AnyTool | undefined {
    return this.#tools.get(name)
  }

  has(name: string): boolean {
    return this.#tools.has(name)
  }

  list(): AnyTool[] {
    return [...this.#tools.values()]
  }

  names(): string[] {
    return [...this.#tools.keys()].sort()
  }

  get size(): number {
    return this.#tools.size
  }
}

export function jsonSchemaOf(schema: z.ZodType<unknown>): object {
  return z.toJSONSchema(schema)
}
