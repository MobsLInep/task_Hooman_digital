import { join } from 'node:path'
import { MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron'
import {
  DocumentImportError,
  FAILURE_MESSAGES,
  type DocumentKind,
  type ParsedDocument,
  type ParseRequest,
  type ParseResponse
} from '@core/documents'

const DEFAULT_TIMEOUT_MS = 120_000

interface Pending {
  resolve: (document: ParsedDocument) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class DocumentParserClient {
  #child: UtilityProcess | undefined
  #port: Electron.MessagePortMain | undefined
  readonly #pending = new Map<string, Pending>()
  #sequence = 0

  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  async parse(bytes: Uint8Array, kind: DocumentKind, filename: string): Promise<ParsedDocument> {
    const port = this.#ensureWorker()
    const id = `parse-${++this.#sequence}`

    return new Promise<ParsedDocument>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)

        this.#teardown('timeout')
        reject(
          new DocumentImportError('parse_timeout', FAILURE_MESSAGES.parse_timeout, { filename })
        )
      }, this.timeoutMs)

      this.#pending.set(id, { resolve, reject, timer })

      const request: ParseRequest = { id, kind, filename, bytes }
      port.postMessage(request)
    })
  }

  dispose(): void {
    this.#teardown('disposed')
  }

  #ensureWorker(): Electron.MessagePortMain {
    if (this.#port) return this.#port

    const { port1, port2 } = new MessageChannelMain()
    const child = utilityProcess.fork(join(__dirname, 'workers/documentParser.js'), [], {
      serviceName: 'task1-document-parser'
    })

    child.postMessage('port', [port2])
    child.on('exit', (code) => this.#teardown(`worker exited with code ${code}`))

    port1.on('message', (event) => {
      const response = event.data as ParseResponse
      const pending = this.#pending.get(response.id)
      if (!pending) return

      clearTimeout(pending.timer)
      this.#pending.delete(response.id)

      if (response.ok) pending.resolve(response.document)
      else pending.reject(new DocumentImportError(response.reason, response.message))
    })
    port1.start()

    this.#child = child
    this.#port = port1
    return port1
  }

  #teardown(why: string): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(
        new DocumentImportError('worker_crashed', FAILURE_MESSAGES.worker_crashed, { why })
      )
      this.#pending.delete(id)
    }

    try {
      this.#child?.kill()
    } catch {}
    this.#child = undefined
    this.#port = undefined
  }
}
