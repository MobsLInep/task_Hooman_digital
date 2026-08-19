export interface SqlStatement {
  run(params?: unknown): { changes: number }
  all(params?: unknown): unknown[]
  get(params?: unknown): unknown
}

export interface SqlDatabase {
  exec(sql: string): unknown
  prepare(sql: string): SqlStatement
  pragma(source: string): unknown
}

export const REQUIRED_PRAGMAS = ['journal_mode = WAL', 'foreign_keys = ON'] as const

export function applyPragmas(db: SqlDatabase): void {
  for (const pragma of REQUIRED_PRAGMAS) db.pragma(pragma)
}
