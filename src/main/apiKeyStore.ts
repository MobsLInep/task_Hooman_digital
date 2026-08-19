import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { registerSecret, forgetSecret, redact } from '@core/ai'
import { SecretsUnavailableError, type ApiKeyStore } from '@core/ai'

export class ElectronApiKeyStore implements ApiKeyStore {
  readonly backend = 'electron-safeStorage'

  readonly #file: string
  #cache: Record<string, string> | undefined

  constructor(file?: string) {
    this.#file = file ?? join(app.getPath('userData'), 'secrets.json')
  }

  selectedBackend(): string {
    if (process.platform !== 'linux') return process.platform
    try {
      return safeStorage.getSelectedStorageBackend()
    } catch {
      return 'unknown'
    }
  }

  isAvailable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false

    if (process.platform === 'linux') {
      const backend = this.selectedBackend()
      if (backend === 'basic_text' || backend === 'unknown') return false
    }
    return true
  }

  unavailableReason(): string | undefined {
    if (this.isAvailable()) return undefined
    if (!safeStorage.isEncryptionAvailable()) {
      return 'the OS credential service reported no encryption backend'
    }
    return (
      `the only available backend is "${this.selectedBackend()}", which uses a ` +
      'hardcoded key rather than a real keyring — install and run gnome-keyring ' +
      'or kwallet to store credentials securely'
    )
  }

  async get(ref: string): Promise<string | undefined> {
    const encoded = this.#read()[ref]
    if (!encoded) return undefined
    if (!this.isAvailable())
      throw new SecretsUnavailableError(this.backend, this.unavailableReason()!)

    try {
      const secret = safeStorage.decryptString(Buffer.from(encoded, 'base64'))
      registerSecret(secret)
      return secret
    } catch (cause) {
      throw new Error(`Failed to decrypt credential "${ref}": ${redact(cause)}`, { cause })
    }
  }

  async set(ref: string, secret: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new SecretsUnavailableError(this.backend, this.unavailableReason()!)
    }
    registerSecret(secret)

    const store = this.#read()
    store[ref] = safeStorage.encryptString(secret).toString('base64')
    this.#write(store)
  }

  async delete(ref: string): Promise<void> {
    const store = this.#read()
    if (!(ref in store)) return

    try {
      const existing = await this.get(ref)
      if (existing) forgetSecret(existing)
    } catch {}

    delete store[ref]
    this.#write(store)
  }

  async listRefs(): Promise<string[]> {
    return Object.keys(this.#read())
  }

  #read(): Record<string, string> {
    if (this.#cache) return this.#cache
    if (!existsSync(this.#file)) {
      this.#cache = {}
      return this.#cache
    }
    try {
      this.#cache = JSON.parse(readFileSync(this.#file, 'utf8')) as Record<string, string>
    } catch {
      this.#cache = {}
    }
    return this.#cache
  }

  #write(store: Record<string, string>): void {
    const temporary = `${this.#file}.tmp`
    writeFileSync(temporary, JSON.stringify(store, null, 2), { mode: 0o600 })
    renameSync(temporary, this.#file)
    this.#cache = store
  }
}
