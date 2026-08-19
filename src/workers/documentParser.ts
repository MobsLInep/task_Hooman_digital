import { parseDocument } from '@core/documents'
import { describe } from '@core/documents'
import type { ParseRequest, WorkerMessage } from '@core/documents'

export async function handleParseRequest(request: ParseRequest): Promise<WorkerMessage> {
  try {
    const document = await parseDocument(request.bytes, request.kind)
    return { id: request.id, ok: true, document }
  } catch (error) {
    const { reason, message } = describe(error)
    return { id: request.id, ok: false, reason, message }
  }
}

process.parentPort?.on('message', (event) => {
  const [port] = event.ports
  if (!port) return

  port.start()
  port.on('message', (incoming) => {
    const request = incoming.data as ParseRequest
    void handleParseRequest(request).then((response) => {
      port.postMessage(response)
    })
  })

  port.postMessage({ id: 'ready', ok: true, document: { kind: 'text', pages: [], pageCount: 0 } })
})

process.on('unhandledRejection', (reason) => {
  console.error('[documentParser] unhandled rejection:', reason)
})
