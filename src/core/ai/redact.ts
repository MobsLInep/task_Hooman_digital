const secrets = new Set<string>()

export function registerSecret(secret: string): void {
  if (secret && secret.length >= 8) secrets.add(secret)
}

export function forgetSecret(secret: string): void {
  secrets.delete(secret)
}

export function clearSecretRegistry(): void {
  secrets.clear()
}

export const REDACTED = '[redacted]'

interface Rule {
  pattern: RegExp
  replace: (...args: string[]) => string
}

const RULES: readonly Rule[] = [
  {
    pattern: /\b(authorization)("?\s*[:=]\s*"?)(bearer\s+)?[\w\-.~+/]{12,}={0,2}/gi,
    replace: (_m, label = '', sep = '', bearer = '') => `${label}${sep}${bearer ?? ''}${REDACTED}`
  },

  { pattern: /\bbearer\s+[\w\-.~+/]{12,}={0,2}/gi, replace: () => `Bearer ${REDACTED}` },

  { pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replace: () => REDACTED },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, replace: () => REDACTED },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replace: () => REDACTED },

  {
    pattern:
      /\b(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|credential)\b("?\s*[:=]\s*"?)([^"\s,;}]{8,})/gi,
    replace: (_m, label = '', sep = '') => `${label}${sep}${REDACTED}`
  },

  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s@]+)@/gi,
    replace: (_m, prefix = '') => `${prefix}:${REDACTED}@`
  }
]

export function redact(value: unknown): string {
  return scrub(stringify(value))
}

export function redactLine(...parts: unknown[]): string {
  return parts.map((part) => (typeof part === 'string' ? scrub(part) : redact(part))).join(' ')
}

function scrub(input: string): string {
  let output = input

  for (const secret of secrets) {
    if (!secret) continue
    output = output.split(secret).join(REDACTED)

    const escaped = JSON.stringify(secret).slice(1, -1)
    if (escaped !== secret) output = output.split(escaped).join(REDACTED)

    const encoded = encodeURIComponent(secret)
    if (encoded !== secret) output = output.split(encoded).join(REDACTED)
  }

  for (const rule of RULES) {
    output = output.replace(rule.pattern, (...args: unknown[]) => {
      const groups = args.slice(0, -2).map((arg) => (typeof arg === 'string' ? arg : ''))
      return rule.replace(...groups)
    })
  }

  return output
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}${
      value.cause ? `\ncaused by ${stringify(value.cause)}` : ''
    }`
  }

  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === 'bigint') return item.toString()
        if (item instanceof Error) return `${item.name}: ${item.message}`
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item)) return '[circular]'
          seen.add(item)
        }
        return item
      }) ?? String(value)
    )
  } catch {
    return String(value)
  }
}

export type LogSink = (line: string) => void

export function createRedactingLogger(sink: LogSink): (...parts: unknown[]) => void {
  return (...parts: unknown[]) => sink(redactLine(...parts))
}
