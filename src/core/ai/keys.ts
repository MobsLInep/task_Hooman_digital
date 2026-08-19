import { registerSecret, forgetSecret } from './redact'

export interface ApiKeyStore {
  readonly backend: string

  isAvailable(): boolean

  get(ref: string): Promise<string | undefined>
  set(ref: string, secret: string): Promise<void>
  delete(ref: string): Promise<void>
  listRefs(): Promise<string[]>
}

export class SecretsUnavailableError extends Error {
  constructor(backend: string, detail: string) {
    super(
      `${backend} cannot encrypt secrets on this system: ${detail}. ` +
        'Refusing to write the credential in plaintext.'
    )
    this.name = 'SecretsUnavailableError'
  }
}

export class InMemoryApiKeyStore implements ApiKeyStore {
  readonly backend = 'in-memory'
  readonly #values = new Map<string, string>()

  isAvailable(): boolean {
    return true
  }

  async get(ref: string): Promise<string | undefined> {
    return this.#values.get(ref)
  }

  async set(ref: string, secret: string): Promise<void> {
    registerSecret(secret)
    this.#values.set(ref, secret)
  }

  async delete(ref: string): Promise<void> {
    const existing = this.#values.get(ref)
    if (existing) forgetSecret(existing)
    this.#values.delete(ref)
  }

  async listRefs(): Promise<string[]> {
    return [...this.#values.keys()]
  }
}
