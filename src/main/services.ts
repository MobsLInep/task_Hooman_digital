import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  GenerationController,
  MockProvider,
  OllamaNodePoolProvider,
  loadNodeRegistry,
  type AiProvider
} from '@core/ai'
import { DriftTracker } from '@core/context'
import { WorkspaceDirectory, WorkspaceRepositories, type SqlDatabase } from '@core/persistence'
import { Bm25Retriever, DocumentPipeline } from '@core/documents'
import { ToolRegistry, ToolRunner, createDefaultTools, createToolActivitySink } from '@core/tools'
import { getDatabase } from './database'
import { DocumentParserClient } from './documentParser'
import { GenerationHub, type Broadcast } from './generationHub'

export interface Services {
  db: SqlDatabase
  directory: WorkspaceDirectory
  repos(workspaceId: string): WorkspaceRepositories
  provider: AiProvider
  hub: GenerationHub
  tools: ToolRegistry
  runner(workspaceId: string): ToolRunner
  pipeline(workspaceId: string): DocumentPipeline
  retriever(workspaceId: string): Bm25Retriever
  drift: DriftTracker
  parser: DocumentParserClient
  newId(): string
}

let services: Services | undefined

export function buildServices(broadcast: Broadcast): Services {
  if (services) return services

  const db = getDatabase() as unknown as SqlDatabase
  const directory = new WorkspaceDirectory(db)
  const newId = (): string => randomUUID()

  const repos = (workspaceId: string): WorkspaceRepositories =>
    new WorkspaceRepositories(db, workspaceId)

  const provider = createProvider()

  const drift = new DriftTracker({ log: (line) => console.log(line) })

  const hub = new GenerationHub({
    broadcast,
    controllerFor: (workspaceId) =>
      new GenerationController({
        provider,
        messages: repos(workspaceId).messages,
        newId,
        driftTracker: drift,
        log: (line) => console.log(line)
      })
  })

  const tools = new ToolRegistry().registerAll(
    createDefaultTools({
      notes: (workspaceId) => repos(workspaceId).notes,
      chunks: (workspaceId) => repos(workspaceId).chunks,
      documents: (workspaceId) => repos(workspaceId).documents
    })
  )

  const parser = new DocumentParserClient()

  services = {
    db,
    directory,
    repos,
    provider,
    hub,
    tools,
    drift,
    parser,
    newId,
    runner: (workspaceId) =>
      new ToolRunner({
        registry: tools,
        activity: createToolActivitySink(repos(workspaceId).activity, newId),
        logger: (line) => console.log(line)
      }),
    pipeline: (workspaceId) =>
      new DocumentPipeline({
        documents: repos(workspaceId).documents,
        chunks: repos(workspaceId).chunks,
        parse: (bytes, kind, filename) => parser.parse(bytes, kind, filename),
        newId,
        log: (line) => console.log(line)
      }),
    retriever: (workspaceId) => new Bm25Retriever(repos(workspaceId).chunks)
  }

  return services
}

export function createProvider(): AiProvider {
  if (process.env['TASK1_PROVIDER']?.toLowerCase() === 'ollama') {
    const registry = loadNodeRegistry(join(__dirname, 'ollama-nodes.json'))
    console.log('[provider] ollama node pool')
    return new OllamaNodePoolProvider({ registry, log: (line) => console.log(line) })
  }

  console.log(
    '[provider] mock (deterministic, offline). Set TASK1_PROVIDER=ollama for the node pool.'
  )

  return new MockProvider({ chunkDelayMs: 90, chunkCount: 110 })
}

export function getServices(): Services {
  if (!services) throw new Error('Services accessed before buildServices()')
  return services
}

export function ensureFirstWorkspace(directory: WorkspaceDirectory, newId: () => string): string {
  const existing = directory.list()
  if (existing.length > 0) return existing[0]!.id

  return directory.create(newId(), 'My workspace').id
}
