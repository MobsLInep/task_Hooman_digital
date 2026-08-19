import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  MAX_RESULT_TOKENS,
  MAX_TOOL_ITERATIONS,
  TOOL_LIMIT_NOTICE,
  ToolRegistry,
  ToolRunner,
  createDefaultTools,
  jsonSchemaOf,
  parseToolCalls,
  runToolLoop,
  type AnyTool,
  type LoopTurn,
  type ToolInvocation
} from '@core/tools'
import { WorkspaceDirectory, WorkspaceRepositories, type SqlDatabase } from '@core/persistence'
import { migratedDb } from '../persistence/helpers'
import { z } from 'zod'

const FENCE = '`'.repeat(3)
const block = (payload: string, label = 'json'): string => `${FENCE}${label}\n${payload}\n${FENCE}`

let db: Database.Database & SqlDatabase
let registry: ToolRegistry
let runner: ToolRunner
let invocations: ToolInvocation[]

function reposFor(workspaceId: string): WorkspaceRepositories {
  return new WorkspaceRepositories(db, workspaceId)
}

beforeEach(() => {
  db = migratedDb()
  const directory = new WorkspaceDirectory(db)
  directory.create('ws-a', 'A')
  directory.create('ws-b', 'B')

  invocations = []
  registry = new ToolRegistry().registerAll(
    createDefaultTools({
      notes: (workspaceId) => reposFor(workspaceId).notes,
      chunks: (workspaceId) => reposFor(workspaceId).chunks,
      documents: (workspaceId) => reposFor(workspaceId).documents,
      now: () => new Date('2026-08-19T10:30:00.000Z')
    })
  )
  runner = new ToolRunner({
    registry,
    activity: { record: (invocation) => invocations.push(invocation) }
  })
})

describe('argument validation', () => {
  it('returns a structured error with the zod issue path, never throwing', async () => {
    const result = await runner.run('calculator', { expression: 42 }, 'ws-a')

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe('validation_error')
    expect(result.error.issues).toBeDefined()
    expect(result.error.issues![0]).toMatchObject({
      path: 'expression',
      code: 'invalid_type'
    })

    expect(result.error.message).toContain('expression')
  })

  it.each([
    ['missing required field', 'calculator', {}, 'expression'],
    ['wrong type', 'calculator', { expression: [] }, 'expression'],
    ['out of range', 'calculator', { expression: '1+1', precision: 99 }, 'precision'],
    ['too long', 'calculator', { expression: 'x'.repeat(600) }, 'expression'],
    ['bad enum', 'datetime', { operation: 'teleport' }, 'operation'],
    ['cross-field rule', 'datetime', { operation: 'add' }, 'amount'],
    ['cross-field rule', 'datetime', { operation: 'diff' }, 'to'],
    ['null args', 'notes_search', null, 'query'],
    ['array args', 'notes_search', [1, 2, 3], '']
  ])('%s on %s is structured, not thrown', async (_label, tool, args, expectedPath) => {
    const result = await runner.run(tool, args, 'ws-a')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('validation_error')
    expect(result.error.issues!.length).toBeGreaterThan(0)
    if (expectedPath) {
      expect(result.error.issues!.some((issue) => issue.path === expectedPath)).toBe(true)
    }
  })

  it('strips unknown keys instead of failing the call', async () => {
    const result = await runner.run('calculator', { expression: '2+2', nope: 1 }, 'ws-a')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toContain('"result": "4"')
      expect(result.content).not.toContain('nope')
    }
  })

  it('records the failure as an activity row rather than losing it', async () => {
    await runner.run('calculator', { expression: 42 }, 'ws-a')

    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toMatchObject({ tool: 'calculator', outcome: 'validation_error' })
    expect(invocations[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('reports an unknown tool with the list of real ones', async () => {
    const result = await runner.run('rm_rf', { x: 1 }, 'ws-a')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('unknown_tool')
    expect(result.error.message).toContain('calculator')
    expect(invocations[0]!.outcome).toBe('unknown_tool')
  })

  it('captures a tool that throws, as data', async () => {
    registry.register({
      name: 'explodes',
      description: 'always throws',
      schema: z.object({}),
      jsonSchema: () => jsonSchemaOf(z.object({})),
      requiresWorkspace: true,
      execute: async () => {
        throw new Error('boom')
      }
    })

    const result = await runner.run('explodes', {}, 'ws-a')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('error')
    expect(invocations[0]!.outcome).toBe('error')
  })

  it('times a slow tool out instead of hanging', async () => {
    registry.register({
      name: 'slow',
      description: 'never finishes',
      schema: z.object({}),
      jsonSchema: () => jsonSchemaOf(z.object({})),
      requiresWorkspace: true,
      timeoutMs: 20,

      execute: () => new Promise(() => {})
    })

    const result = await runner.run('slow', {}, 'ws-a')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('timeout')
      expect(result.error.message).toMatch(/20ms/)
    }
  })
})

describe('forged workspace identity', () => {
  beforeEach(() => {
    reposFor('ws-a').notes.create({ id: 'note-a', title: 'A note', body: 'kestrel over water' })
    reposFor('ws-b').notes.create({ id: 'note-b', title: 'B note', body: 'kestrel over meadow' })
  })

  it('notes_search returns only active-workspace rows despite a forged id', async () => {
    for (const forged of [
      { query: 'kestrel', workspaceId: 'ws-b' },
      { query: 'kestrel', workspace_id: 'ws-b' },
      { query: 'kestrel', ctx: { workspaceId: 'ws-b' } },
      { query: 'kestrel', workspaceId: "ws-b' OR 1=1 --" }
    ]) {
      const result = await runner.run('notes_search', forged, 'ws-a')

      expect(result.ok, JSON.stringify(forged)).toBe(true)
      if (!result.ok) continue

      expect(result.content).toContain('note-a')
      expect(result.content).not.toContain('note-b')
      expect(result.content).not.toContain('meadow')
    }
  })

  it('document_search is scoped the same way', async () => {
    for (const workspace of ['ws-a', 'ws-b'] as const) {
      const repos = reposFor(workspace)
      repos.documents.create({
        id: `doc-${workspace}`,
        filename: `${workspace}.pdf`,
        mime: 'application/pdf',
        sha256: workspace.repeat(10),
        sizeBytes: 10
      })
      repos.chunks.insert({
        id: `chunk-${workspace}`,
        documentId: `doc-${workspace}`,
        ordinal: 0,
        text: `peregrine material belonging to ${workspace}`,
        pageFrom: 3,
        pageTo: 4
      })
    }

    const result = await runner.run(
      'document_search',
      { query: 'peregrine', workspaceId: 'ws-b' },
      'ws-a'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content).toContain('ws-a')
    expect(result.content).not.toContain('ws-b')

    expect(result.content).toContain('ws-a.pdf')
    expect(result.content).toContain('pp. 3-4')
  })

  it('has no workspace field in any tool schema, so one cannot even be expressed', () => {
    for (const tool of registry.list()) {
      const schema = JSON.stringify(tool.jsonSchema())
      expect(schema, tool.name).not.toMatch(/workspace/i)
      expect(tool.requiresWorkspace).toBe(true)
    }
  })
})

describe('tool loop cap', () => {
  function insatiable(): {
    generate: (t: readonly LoopTurn[]) => Promise<string>
    calls: () => number
  } {
    let count = 0
    return {
      calls: () => count,
      generate: async () => {
        count++
        return `Working on it.\n${block('{"tool": "calculator", "args": {"expression": "1+1"}}')}`
      }
    }
  }

  it('executes at most 5 iterations and refuses the 6th', async () => {
    const model = insatiable()
    const result = await runToolLoop(model.generate, { runner, workspaceId: 'ws-a' })

    expect(result.iterations).toBe(MAX_TOOL_ITERATIONS)
    expect(result.iterations).toBe(5)
    expect(result.stoppedAtLimit).toBe(true)

    expect(result.results).toHaveLength(5)
    expect(invocations).toHaveLength(5)

    const notice = result.transcript.filter((turn) => turn.content === TOOL_LIMIT_NOTICE)
    expect(notice).toHaveLength(1)
  })

  it('respects a lower cap', async () => {
    const model = insatiable()
    const result = await runToolLoop(model.generate, {
      runner,
      workspaceId: 'ws-a',
      maxIterations: 2
    })

    expect(result.iterations).toBe(2)
    expect(result.results).toHaveLength(2)
    expect(result.stoppedAtLimit).toBe(true)
  })

  it('stops as soon as the model answers without calling a tool', async () => {
    let turn = 0
    const result = await runToolLoop(
      async () => {
        turn++
        return turn === 1
          ? block('{"tool": "calculator", "args": {"expression": "6*7"}}')
          : 'The answer is 42.'
      },
      { runner, workspaceId: 'ws-a' }
    )

    expect(result.iterations).toBe(1)
    expect(result.stoppedAtLimit).toBe(false)
    expect(result.answer).toBe('The answer is 42.')
    expect(result.results[0]!.ok).toBe(true)
  })

  it('feeds a malformed block back as a tool_error instead of crashing', async () => {
    let turn = 0
    const result = await runToolLoop(
      async () => {
        turn++
        if (turn === 1) return block('{"tool": "calculator", "args": {oops}}', 'tool_call')
        if (turn === 2) return block('{"tool": "calculator", "args": {"expression": "2+2"}}')
        return 'Sorry about that — the answer is 4.'
      },
      { runner, workspaceId: 'ws-a' }
    )

    expect(result.answer).toBe('Sorry about that — the answer is 4.')
    const errorTurn = result.transcript.find((t) => t.content.includes('tool_error'))
    expect(errorTurn).toBeDefined()
    expect(errorTurn!.content).toMatch(/Not valid JSON|fenced json block/)

    expect(invocations.map((i) => i.outcome)).toEqual(['ok'])
  })
})

describe('protocol parsing', () => {
  it('extracts a call and strips it from the visible text', () => {
    const parsed = parseToolCalls(
      `Let me check.\n${block('{"tool": "notes_search", "args": {"query": "falcon"}}')}\nOne moment.`
    )

    expect(parsed.calls).toEqual([
      { tool: 'notes_search', args: { query: 'falcon' }, raw: expect.any(String) }
    ])
    expect(parsed.text).not.toContain('notes_search')
    expect(parsed.text).toContain('Let me check.')
    expect(parsed.errors).toEqual([])
  })

  it('leaves an ordinary json block alone', () => {
    const parsed = parseToolCalls(`Here is the config:\n${block('{"port": 8080, "debug": true}')}`)

    expect(parsed.calls).toEqual([])
    expect(parsed.errors).toEqual([])
    expect(parsed.text).toContain('8080')
  })

  it('reports a broken block only when it was explicitly labelled a call', () => {
    const labelled = parseToolCalls(block('{"tool": broken}', 'tool_call'))
    expect(labelled.errors).toHaveLength(1)
    expect(labelled.calls).toEqual([])

    const unlabelled = parseToolCalls(block('{not json at all}'))
    expect(unlabelled.errors).toEqual([])
    expect(unlabelled.text).toContain('not json at all')
  })

  it('accepts several calls in one message', () => {
    const parsed = parseToolCalls(
      [
        block('{"tool": "calculator", "args": {"expression": "1+1"}}'),
        block('{"tool": "datetime", "args": {"operation": "now"}}')
      ].join('\n')
    )
    expect(parsed.calls.map((call) => call.tool)).toEqual(['calculator', 'datetime'])
  })

  it('rejects a call whose args are not an object', () => {
    const parsed = parseToolCalls(block('{"tool": "calculator", "args": "1+1"}'))
    expect(parsed.calls).toEqual([])
    expect(parsed.errors[0]!.message).toMatch(/must be a JSON object/)
  })
})

describe('result serialization', () => {
  it('caps a huge result and says so inside the text', async () => {
    registry.register({
      name: 'firehose',
      description: 'returns far too much',
      schema: z.object({}),
      jsonSchema: () => jsonSchemaOf(z.object({})),
      requiresWorkspace: true,
      execute: async () => 'word '.repeat(40_000)
    })

    const result = await runner.run('firehose', {}, 'ws-a')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.truncated).toBe(true)

    expect(result.content).toContain('[truncated')
    expect(result.content).toContain(String(MAX_RESULT_TOKENS))
    expect(result.content.length).toBeLessThan('word '.repeat(40_000).length)
  })

  it('leaves a small result untouched', async () => {
    const result = await runner.run('calculator', { expression: '2+2' }, 'ws-a')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(false)
    expect(result.content).toContain('"result": "4"')
  })
})

describe('calculator', () => {
  const run = (expression: string, precision?: number) =>
    runner.run(
      'calculator',
      precision === undefined ? { expression } : { expression, precision },
      'ws-a'
    )

  it.each([
    ['2 + 2 * 3', '8'],
    ['sqrt(144)', '12'],
    ['(1 + 2) ^ 3', '27'],
    ['5 km to miles', '3.10685596']
  ])('evaluates %s', async (expression, expected) => {
    const result = await run(expression)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toContain(expected)
  })

  it.each([
    ['function definition', 'f(x) = x^2', /Function definitions are not allowed/],
    ['assignment', 'x = 5', /Assignments are not allowed/],
    ['import', 'import("fs")', /not available/],
    ['nested evaluate', 'evaluate("1+1")', /not available/]
  ])('refuses %s', async (_label, expression, expected) => {
    const result = await run(expression)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('error')
      expect(result.error.message).toMatch(expected)
    }
  })

  it('does not hang on an expression designed to blow up', async () => {
    const started = Date.now()
    const result = await run('9^9^9')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(result.ok).toBe(true)
  })

  it('honours precision', async () => {
    const result = await run('1/3', 4)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toContain('0.3333')
  })
})

describe('datetime', () => {
  const run = (args: Record<string, unknown>) => runner.run('datetime', args, 'ws-a')

  it('reports the current time from the injected clock', async () => {
    const result = await run({ operation: 'now' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toContain('2026-08-19T10:30:00.000Z')
  })

  it('converts to another timezone', async () => {
    const result = await run({ operation: 'convert', timezone: 'Asia/Kolkata' })
    expect(result.ok).toBe(true)

    if (result.ok) expect(result.content).toContain('16:00:00')
  })

  it('rejects a timezone that does not exist', async () => {
    const result = await run({ operation: 'convert', timezone: 'Mars/Olympus' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/not a recognised IANA timezone/)
  })

  it('adds durations, clamping the day when a month is shorter', async () => {
    const result = await run({
      operation: 'add',
      datetime: '2026-01-31T00:00:00Z',
      amount: 1,
      unit: 'months'
    })
    expect(result.ok).toBe(true)

    if (result.ok) expect(result.content).toContain('2026-02-28')
  })

  it('measures the gap between two instants', async () => {
    const result = await run({
      operation: 'diff',
      datetime: '2026-08-19T10:00:00Z',
      to: '2026-08-21T10:00:00Z'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toContain('"days": 2')
      expect(result.content).toContain('2 days later')
    }
  })

  it('rejects an unparseable datetime', async () => {
    const result = await run({ operation: 'convert', datetime: 'last tuesday' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/not a valid ISO 8601/)
  })
})

describe('registry', () => {
  it('registers the four default tools', () => {
    expect(registry.names()).toEqual(['calculator', 'datetime', 'document_search', 'notes_search'])
  })

  it('refuses a duplicate name', () => {
    expect(() => registry.register(registry.list()[0] as AnyTool)).toThrow(/already registered/)
  })

  it('refuses a name that is not snake_case', () => {
    const bad = { ...(registry.list()[0] as AnyTool), name: 'Not Snake' }
    expect(() => registry.register(bad)).toThrow(/snake_case/)
  })

  it('derives every JSON Schema from zod rather than by hand', () => {
    for (const tool of registry.list()) {
      const schema = tool.jsonSchema() as Record<string, unknown>
      expect(schema['type']).toBe('object')
      expect(schema['properties']).toBeDefined()

      expect(schema['additionalProperties']).toBe(false)
    }
  })
})
