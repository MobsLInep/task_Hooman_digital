import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearSecretRegistry,
  createRedactingLogger,
  InMemoryApiKeyStore,
  redact,
  redactLine,
  REDACTED,
  registerSecret
} from '@core/ai'

const KEY = 'sk-live-9f3b7c2e1a8d4f6b0c5e7a9d2b4f6081'

beforeEach(() => {
  clearSecretRegistry()
})

describe('redact', () => {
  it('never lets a registered key reach serialized output', () => {
    registerSecret(KEY)

    const shapes: unknown[] = [
      KEY,
      `Authorization: Bearer ${KEY}`,
      { apiKey: KEY },
      { nested: { deep: [{ credential: KEY }] } },
      new Error(`request failed with key ${KEY}`),
      { headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify({ key: KEY }) },
      [KEY, KEY, KEY],
      `connect to https://user:${KEY}@node.example/api`,
      JSON.stringify({ token: KEY }),
      { toJSON: () => ({ leaked: KEY }) }
    ]

    for (const shape of shapes) {
      const output = redact(shape)
      expect(output, `leaked from ${JSON.stringify(shape).slice(0, 60)}`).not.toContain(KEY)
      expect(output).toContain(REDACTED)
    }
  })

  it('scrubs the key even when JSON-escaped or percent-encoded', () => {
    const awkward = 'sk-live-with/slash+plus"quote_and_more_padding'
    registerSecret(awkward)

    const jsonEscaped = JSON.stringify({ key: awkward })
    expect(redact(jsonEscaped)).not.toContain(JSON.stringify(awkward).slice(1, -1))

    const urlEncoded = `https://node.example/?token=${encodeURIComponent(awkward)}`
    expect(redact(urlEncoded)).not.toContain(encodeURIComponent(awkward))
  })

  it('redacts secret-shaped text that was never registered', () => {
    expect(redact('Authorization: Bearer abcdef0123456789abcdef')).not.toContain('abcdef0123456789')
    expect(redact('sk-abcdefghijklmnop0123456789')).toContain(REDACTED)
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz0123')).toContain(REDACTED)
    expect(redact('{"api_key": "supersecretvalue123"}')).not.toContain('supersecretvalue123')
    expect(redact('postgres://admin:hunter2hunter2@db.internal/app')).not.toContain(
      'hunter2hunter2'
    )
  })

  it('keeps the label so a redacted line still says what was removed', () => {
    const line = redact('api_key=supersecretvalue123')
    expect(line).toContain('api_key')
    expect(line).toContain(REDACTED)
    expect(line).not.toContain('supersecretvalue123')
  })

  it('survives values that would break a naive logger', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    expect(() => redact(circular)).not.toThrow()
    expect(redact(circular)).toContain('[circular]')

    const hostile = {
      toJSON() {
        throw new Error('nope')
      }
    }
    expect(() => redact(hostile)).not.toThrow()

    expect(redact(undefined)).toBeTypeOf('string')
    expect(redact(123n)).toBe('"123"')
  })

  it('does not redact short values that would shred the log', () => {
    registerSecret('abc')
    expect(redact('abc def')).toBe('abc def')
  })
})

describe('redactLine and the logger', () => {
  it('redacts every argument of a log line', () => {
    registerSecret(KEY)
    const line = redactLine('[ollama] auth failed for', { url: 'http://n', token: KEY })

    expect(line).not.toContain(KEY)
    expect(line).toContain('[ollama] auth failed for')
  })

  it('redacts before anything reaches the sink', () => {
    registerSecret(KEY)
    const written: string[] = []
    const log = createRedactingLogger((line) => written.push(line))

    log('sending', { authorization: `Bearer ${KEY}` })
    log(new Error(`boom ${KEY}`))

    expect(written).toHaveLength(2)
    for (const line of written) expect(line).not.toContain(KEY)
  })
})

describe('ApiKeyStore registers what it stores', () => {
  it('makes a stored secret unloggable from then on', async () => {
    const store = new InMemoryApiKeyStore()

    const fresh = 'totally-opaque-value-9182736455'
    expect(redact(`node replied: ${fresh}`)).toContain(fresh)
    expect(redact({ echoedBackByNode: fresh })).toContain(fresh)

    await store.set('ollama.node.token', fresh)

    expect(redact(`node replied: ${fresh}`)).not.toContain(fresh)
    expect(redact({ echoedBackByNode: fresh })).not.toContain(fresh)
    expect(await store.get('ollama.node.token')).toBe(fresh)
  })

  it('reports its backend honestly', () => {
    const store = new InMemoryApiKeyStore()
    expect(store.backend).toBe('in-memory')
    expect(store.isAvailable()).toBe(true)
  })
})
