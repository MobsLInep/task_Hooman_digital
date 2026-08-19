import { z } from 'zod'
import { jsonSchemaOf } from '../registry'
import type { Tool, ToolContext } from '../types'

const operation = z.enum(['now', 'convert', 'add', 'diff'])

export const datetimeArgs = z
  .object({
    operation: operation.describe(
      "'now' for the current time, 'convert' to restate an instant in another zone, " +
        "'add' for date arithmetic, 'diff' for the gap between two instants."
    ),
    timezone: z
      .string()
      .max(64)
      .optional()
      .describe("IANA timezone, e.g. 'Europe/London', 'Asia/Kolkata'. Defaults to UTC."),
    datetime: z
      .string()
      .max(64)
      .optional()
      .describe("ISO 8601 instant, e.g. '2026-08-19T10:30:00Z'. Defaults to now."),
    to: z.string().max(64).optional().describe("Second ISO 8601 instant, for 'diff'."),
    amount: z.number().int().min(-100_000).max(100_000).optional().describe("Amount for 'add'."),
    unit: z
      .enum(['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'])
      .optional()
      .describe("Unit for 'add'.")
  })

  .refine((value) => value.operation !== 'add' || (value.amount !== undefined && value.unit), {
    message: "operation 'add' requires both 'amount' and 'unit'",
    path: ['amount']
  })
  .refine((value) => value.operation !== 'diff' || value.to !== undefined, {
    message: "operation 'diff' requires 'to'",
    path: ['to']
  })

export type DatetimeArgs = z.infer<typeof datetimeArgs>

export interface DatetimeResult {
  operation: string
  iso: string
  formatted?: string
  timezone?: string
  difference?: { seconds: number; minutes: number; hours: number; days: number; humanised: string }
}

export function createDatetimeTool(
  now: () => Date = () => new Date()
): Tool<DatetimeArgs, DatetimeResult> {
  return {
    name: 'datetime',
    description:
      'Get the current date and time, restate an instant in another timezone, add or subtract ' +
      'a duration, or measure the gap between two instants. Timezones are IANA names.',
    schema: datetimeArgs,
    jsonSchema: () => jsonSchemaOf(datetimeArgs),
    requiresWorkspace: true,

    async execute(args: DatetimeArgs, _ctx: ToolContext): Promise<DatetimeResult> {
      const zone = args.timezone ?? 'UTC'
      assertZone(zone)

      const base = args.datetime ? parseInstant(args.datetime) : now()

      switch (args.operation) {
        case 'now':
        case 'convert':
          return {
            operation: args.operation,
            iso: base.toISOString(),
            formatted: formatIn(base, zone),
            timezone: zone
          }

        case 'add': {
          const shifted = addDuration(base, args.amount!, args.unit!)
          return {
            operation: 'add',
            iso: shifted.toISOString(),
            formatted: formatIn(shifted, zone),
            timezone: zone
          }
        }

        case 'diff': {
          const to = parseInstant(args.to!)
          const ms = to.getTime() - base.getTime()
          return {
            operation: 'diff',
            iso: to.toISOString(),
            difference: {
              seconds: Math.round(ms / 1000),
              minutes: Math.round(ms / 60_000),
              hours: Math.round(ms / 3_600_000),
              days: Math.round(ms / 86_400_000),
              humanised: humanise(ms)
            }
          }
        }
      }
    }
  }
}

function assertZone(zone: string): void {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
  } catch {
    throw new Error(
      `"${zone}" is not a recognised IANA timezone. Use a name like "Europe/London" or "UTC".`
    )
  }
}

function parseInstant(value: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`"${value}" is not a valid ISO 8601 date-time, e.g. "2026-08-19T10:30:00Z"`)
  }
  return parsed
}

function formatIn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    dateStyle: 'full',
    timeStyle: 'long'
  }).format(instant)
}

function addDuration(base: Date, amount: number, unit: NonNullable<DatetimeArgs['unit']>): Date {
  const result = new Date(base.getTime())

  switch (unit) {
    case 'seconds':
      result.setUTCSeconds(result.getUTCSeconds() + amount)
      break
    case 'minutes':
      result.setUTCMinutes(result.getUTCMinutes() + amount)
      break
    case 'hours':
      result.setUTCHours(result.getUTCHours() + amount)
      break
    case 'days':
      result.setUTCDate(result.getUTCDate() + amount)
      break
    case 'weeks':
      result.setUTCDate(result.getUTCDate() + amount * 7)
      break
    case 'months':
      return addMonths(base, amount)
    case 'years':
      return addMonths(base, amount * 12)
  }

  return result
}

function addMonths(base: Date, months: number): Date {
  const day = base.getUTCDate()
  const shifted = new Date(base.getTime())
  shifted.setUTCDate(1)
  shifted.setUTCMonth(shifted.getUTCMonth() + months)

  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)
  ).getUTCDate()
  shifted.setUTCDate(Math.min(day, lastDay))

  return shifted
}

function humanise(ms: number): string {
  const past = ms < 0
  const abs = Math.abs(ms)
  const units: [number, string][] = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1000, 'second']
  ]

  for (const [size, name] of units) {
    if (abs >= size) {
      const count = Math.floor(abs / size)
      return `${count} ${name}${count === 1 ? '' : 's'} ${past ? 'earlier' : 'later'}`
    }
  }
  return 'less than a second'
}
