import type { SqlDatabase, SqlStatement } from '../database'

const SCOPE_PREDICATE = /\b(workspace_id|workspaces\.id)\s*=\s*@workspaceId\b/i
const IS_INSERT = /^\s*INSERT\s+INTO\b/i
const INSERT_NAMES_COLUMN = /\bworkspace_id\b/i
const BINDS_WORKSPACE = /@workspaceId\b/

export class WorkspaceScopeError extends Error {}

export function assertScoped(sql: string): void {
  if (IS_INSERT.test(sql)) {
    if (!INSERT_NAMES_COLUMN.test(sql) || !BINDS_WORKSPACE.test(sql)) {
      throw new WorkspaceScopeError(
        'Scoped INSERT must name the workspace_id column and bind @workspaceId.\n' + sql
      )
    }
    return
  }

  if (!SCOPE_PREDICATE.test(sql)) {
    throw new WorkspaceScopeError(
      'Scoped statement must constrain itself with the literal predicate ' +
        '`workspace_id = @workspaceId`.\n' +
        sql
    )
  }
}

export type QueryParams = Record<string, string | number | null>

export abstract class WorkspaceScopedRepository {
  readonly #statements = new Map<string, SqlStatement>()

  protected constructor(
    protected readonly db: SqlDatabase,
    readonly workspaceId: string
  ) {
    if (!workspaceId) {
      throw new WorkspaceScopeError('A workspace-scoped repository requires a workspaceId')
    }
  }

  protected all<T>(sql: string, params: QueryParams = {}): T[] {
    return this.#statement(sql).all(this.#bind(params)) as T[]
  }

  protected get<T>(sql: string, params: QueryParams = {}): T | undefined {
    return this.#statement(sql).get(this.#bind(params)) as T | undefined
  }

  protected run(sql: string, params: QueryParams = {}): number {
    return this.#statement(sql).run(this.#bind(params)).changes
  }

  #statement(sql: string): SqlStatement {
    let statement = this.#statements.get(sql)
    if (!statement) {
      assertScoped(sql)
      statement = this.db.prepare(sql)
      this.#statements.set(sql, statement)
    }
    return statement
  }

  #bind(params: QueryParams): QueryParams {
    return { ...params, workspaceId: this.workspaceId }
  }
}
