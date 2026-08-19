export * from './worker'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface Job<TPayload = unknown> {
  readonly id: string
  readonly kind: string
  readonly payload: TPayload
  status: JobStatus
  error?: string
}

export interface JobQueue {
  enqueue<TPayload>(kind: string, payload: TPayload): Promise<Job<TPayload>>
  next(): Promise<Job | undefined>
  complete(id: string, error?: string): Promise<void>
}
