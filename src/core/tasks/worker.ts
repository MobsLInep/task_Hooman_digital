import type { TaskRepository, TaskRow } from '../persistence'

export interface TaskHandlerContext {
  readonly workspaceId: string
  readonly taskId: string
  readonly attempt: number
  readonly signal: AbortSignal
  checkpoint(partial: unknown): void
  readonly partial: unknown
  log(line: string): void
}

export interface TaskHandler {
  readonly type: string
  handle(payload: unknown, ctx: TaskHandlerContext): Promise<unknown>
}

export interface TaskWorkerOptions {
  tasks: TaskRepository
  workspaceId: string
  handlers: readonly TaskHandler[]
  leaseSeconds?: number
  maxAttempts?: number
  now?: () => Date
  log?: (line: string) => void
}

export const DEFAULT_LEASE_SECONDS = 60
export const DEFAULT_MAX_ATTEMPTS = 3

export type TaskOutcome =
  | { status: 'done'; task: TaskRow; result: unknown }
  | { status: 'retry'; task: TaskRow; error: string; attempt: number }
  | { status: 'failed'; task: TaskRow; error: string }
  | { status: 'idle' }

export class TaskWorker {
  readonly #tasks: TaskRepository
  readonly #workspaceId: string
  readonly #handlers: Map<string, TaskHandler>
  readonly #leaseSeconds: number
  readonly #maxAttempts: number
  readonly #now: () => Date
  readonly #log: (line: string) => void

  constructor(options: TaskWorkerOptions) {
    this.#tasks = options.tasks
    this.#workspaceId = options.workspaceId
    this.#handlers = new Map(options.handlers.map((handler) => [handler.type, handler]))
    this.#leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.#now = options.now ?? (() => new Date())
    this.#log = options.log ?? (() => {})
  }

  async runOnce(signal?: AbortSignal): Promise<TaskOutcome> {
    const task = this.#tasks.claim(this.#leaseSeconds, this.#now())
    if (!task) return { status: 'idle' }

    if (task.attempts > this.#maxAttempts) {
      const error = `Abandoned after ${task.attempts - 1} failed attempts: ${task.error ?? 'no error recorded'}`
      this.#tasks.fail(task.id, error)
      this.#log(`[tasks] ${task.type} ${task.id} abandoned after ${task.attempts - 1} attempts`)
      return { status: 'failed', task, error }
    }

    const handler = this.#handlers.get(task.type)
    if (!handler) {
      const error = `No handler registered for task type "${task.type}"`
      this.#tasks.fail(task.id, error)
      return { status: 'failed', task, error }
    }

    const controller = new AbortController()
    const onAbort = (): void => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })

    const ctx: TaskHandlerContext = {
      workspaceId: this.#workspaceId,
      taskId: task.id,
      attempt: task.attempts,
      signal: controller.signal,
      partial: parseJson(task.partialJson),
      checkpoint: (partial) => {
        this.#tasks.checkpoint(task.id, JSON.stringify(partial))
      },
      log: this.#log
    }

    try {
      const result = await handler.handle(parseJson(task.paramsJson) ?? {}, ctx)
      this.#tasks.complete(task.id, JSON.stringify(result ?? null))
      this.#log(`[tasks] ${task.type} ${task.id} done on attempt ${task.attempts}`)
      return { status: 'done', task, result }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)

      if (task.attempts >= this.#maxAttempts) {
        this.#tasks.fail(task.id, error)
        this.#log(`[tasks] ${task.type} ${task.id} failed permanently: ${error}`)
        return { status: 'failed', task, error }
      }

      this.#tasks.requeue(task.id, error)
      this.#log(`[tasks] ${task.type} ${task.id} failed on attempt ${task.attempts}, requeued`)
      return { status: 'retry', task, error, attempt: task.attempts }
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async drain(max = 100, signal?: AbortSignal): Promise<TaskOutcome[]> {
    const outcomes: TaskOutcome[] = []
    for (let i = 0; i < max; i++) {
      if (signal?.aborted) break
      const outcome = await this.runOnce(signal)
      if (outcome.status === 'idle') break
      outcomes.push(outcome)
    }
    return outcomes
  }
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}
