import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const CORE = resolve(__dirname, '../../src/core')
const FORBIDDEN = /from\s+['"](electron|react|react-dom|zustand)(\/[^'"]*)?['"]/

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
  })
}

const CONTEXT = resolve(__dirname, '../../src/core/context')
const IMPURE =
  /from\s+['"]node:(fs|http|https|net|child_process|dns|crypto)['"]|\bDate\.now\(|new Date\(|Math\.random\(/

describe('src/core/context is pure', () => {
  it('imports no IO and reads no clock or randomness', () => {
    const offenders = walk(CONTEXT)
      .filter((file) => IMPURE.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(CONTEXT.length + 1))

    expect(offenders).toEqual([])
  })
})

const TOOLS = resolve(__dirname, '../../src/core/tools')

const FORBIDDEN_IN_TOOLS =
  /from\s+['"][^'"]*(ai\/(mock|ollama|generation)|core\/ai['"])|from\s+['"]node:(fs|child_process|http|https|net|dns)['"]|\brequire\(|child_process/

describe('src/core/tools is provider-agnostic', () => {
  it('imports no adapter and no filesystem or shell', () => {
    const offenders = walk(TOOLS)
      .filter((file) => FORBIDDEN_IN_TOOLS.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(TOOLS.length + 1))

    expect(offenders).toEqual([])
  })

  it('references no provider type in its CODE', () => {
    const offenders = walk(TOOLS).filter((file) =>
      /\b(MockProvider|OllamaNodePoolProvider|AiProvider)\b/.test(
        stripComments(readFileSync(file, 'utf8'))
      )
    )
    expect(offenders.map((f) => f.slice(TOOLS.length + 1))).toEqual([])
  })
})

describe('src/core import boundary', () => {
  it('contains no Electron or React imports', () => {
    const offenders = walk(CORE).filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
