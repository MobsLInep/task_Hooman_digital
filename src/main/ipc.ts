import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { assembleContext, type ContextCandidate, type ContextReport } from '@core/context'
import { buildToolInstructions, describeTool } from '@core/tools'
import { buildServices, ensureFirstWorkspace, getServices } from './services'
import type { HubEvent } from './generationHub'

export const IPC_EVENT_CHANNEL = 'app:event'

export type AppEvent =
  HubEvent | { type: 'documents:changed'; workspaceId: string } | { type: 'tasks:changed' }

function broadcast(event: AppEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_EVENT_CHANNEL, event)
  }
}

const MODEL = 'mock-small'

export function registerIpcHandlers(): void {
  const services = buildServices(broadcast)
  ensureFirstWorkspace(services.directory, services.newId)

  const handle = <A extends unknown[], R>(
    channel: string,
    fn: (...args: A) => R | Promise<R>
  ): void => {
    ipcMain.handle(channel, async (_event, ...args) => fn(...(args as A)))
  }

  handle('app:getVersion', () => process.versions.electron)

  handle('workspaces:list', () => services.directory.list())
  handle('workspaces:create', (name: string) =>
    services.directory.create(services.newId(), name.trim() || 'Untitled workspace')
  )

  handle('conversations:list', (workspaceId: string) =>
    services.repos(workspaceId).conversations.list()
  )
  handle('conversations:create', (workspaceId: string, title: string) =>
    services.repos(workspaceId).conversations.create({
      id: services.newId(),
      title: title.trim() || 'New conversation',
      modelId: MODEL
    })
  )
  handle('conversations:rename', (workspaceId: string, id: string, title: string) =>
    services.repos(workspaceId).conversations.rename(id, title)
  )
  handle('conversations:delete', (workspaceId: string, id: string) =>
    services.repos(workspaceId).conversations.delete(id)
  )
  handle('conversations:setPinned', (workspaceId: string, id: string, pinned: boolean) =>
    services.repos(workspaceId).conversations.setPinned(id, pinned)
  )

  handle('messages:list', (workspaceId: string, conversationId: string) =>
    services.repos(workspaceId).messages.listByConversation(conversationId)
  )

  handle('notes:list', (workspaceId: string) => services.repos(workspaceId).notes.list())
  handle('notes:create', (workspaceId: string, title: string, body: string) =>
    services.repos(workspaceId).notes.create({ id: services.newId(), title, body })
  )
  handle('notes:update', (workspaceId: string, id: string, title: string, body: string) =>
    services.repos(workspaceId).notes.update(id, title, body)
  )
  handle('notes:delete', (workspaceId: string, id: string) =>
    services.repos(workspaceId).notes.delete(id)
  )

  handle('documents:list', (workspaceId: string) => services.repos(workspaceId).documents.list())

  handle('documents:import', async (workspaceId: string) => {
    const picked = await dialog.showOpenDialog({
      title: 'Import documents',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported', extensions: ['pdf', 'md', 'markdown', 'txt', 'text'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (picked.canceled) return []

    const pipeline = services.pipeline(workspaceId)
    const outcomes: { path: string; filename: string; outcome: unknown }[] = []

    for (const path of picked.filePaths) {
      const info = await stat(path)
      const outcome = await pipeline.ingest({
        candidate: { filename: basename(path), sizeBytes: info.size },

        readBytes: async () => new Uint8Array(await readFile(path))
      })

      outcomes.push({ path, filename: basename(path), outcome })
      broadcast({ type: 'documents:changed', workspaceId })
    }

    return outcomes
  })

  handle(
    'documents:resolveDuplicate',
    async (workspaceId: string, path: string, resolution: 'link-existing' | 'import-as-copy') => {
      const info = await stat(path)
      const outcome = await services.pipeline(workspaceId).ingest({
        candidate: { filename: basename(path), sizeBytes: info.size },
        readBytes: async () => new Uint8Array(await readFile(path)),
        onDuplicate: resolution
      })
      broadcast({ type: 'documents:changed', workspaceId })
      return outcome
    }
  )

  handle('documents:chunks', (workspaceId: string, documentId: string) =>
    services.repos(workspaceId).chunks.listByDocument(documentId)
  )

  handle('tasks:active', () => {
    const rows = []
    for (const workspace of services.directory.list()) {
      const tasks = services.repos(workspace.id).tasks
      for (const status of ['queued', 'running'] as const) {
        for (const task of tasks.listByStatus(status)) {
          rows.push({ ...task, workspaceName: workspace.name })
        }
      }
    }
    return rows
  })

  handle('activity:recent', (workspaceId: string, limit: number) =>
    services.repos(workspaceId).activity.recent(limit)
  )

  handle('generation:snapshot', (conversationId: string) => services.hub.snapshot(conversationId))
  handle('generation:active', () => services.hub.activeConversationIds())
  handle('generation:cancel', (conversationId: string) => services.hub.cancel(conversationId))
  handle(
    'generation:report',
    (conversationId: string) => services.hub.report(conversationId) ?? null
  )

  handle('generation:send', async (workspaceId: string, conversationId: string, text: string) => {
    const repos = services.repos(workspaceId)

    repos.messages.append({
      id: services.newId(),
      conversationId,
      role: 'user',
      content: text,
      status: 'complete'
    })
    repos.conversations.touch(conversationId)

    const { request, report } = buildRequest(workspaceId, conversationId, text)
    services.hub.rememberReport(conversationId, report)

    void services.hub.start(workspaceId, conversationId, request).catch(() => {})
    return { started: true }
  })

  handle(
    'generation:retry',
    async (workspaceId: string, conversationId: string, previousMessageId: string) => {
      const { request, report } = buildRequest(workspaceId, conversationId, '')
      services.hub.rememberReport(conversationId, report)
      void services.hub
        .start(workspaceId, conversationId, request, { kind: 'retry', previousMessageId })
        .catch(() => {})
      return { started: true }
    }
  )

  handle(
    'generation:continue',
    async (workspaceId: string, conversationId: string, partialMessageId: string) => {
      const { request, report } = buildRequest(workspaceId, conversationId, '')
      services.hub.rememberReport(conversationId, report)
      void services.hub
        .start(workspaceId, conversationId, request, { kind: 'continue', partialMessageId })
        .catch(() => {})
      return { started: true }
    }
  )

  handle('inspector:tools', () => services.tools.list().map((tool) => describeTool(tool)))
}

function buildRequest(
  workspaceId: string,
  conversationId: string,
  query: string
): {
  request: Parameters<ReturnType<typeof getServices>['hub']['start']>[2]
  report: ContextReport
} {
  const services = getServices()
  const repos = services.repos(workspaceId)

  const history = repos.messages.listByConversation(conversationId)
  const notes = repos.notes.list().filter((note) => note.pinned === 1)
  const hits = query ? repos.chunks.search(toMatch(query), 6) : []
  const documents = new Map(repos.documents.list().map((doc) => [doc.id, doc]))

  const candidates: ContextCandidate[] = [
    {
      id: 'system',
      kind: 'system',
      text:
        'You are a careful assistant working inside a research workspace. ' +
        'Cite documents you rely on.\n\n' +
        buildToolInstructions(services.tools.list().map((tool) => describeTool(tool))),
      tokens: 0,
      pinned: false,
      source: { type: 'system', label: 'system prompt' }
    },
    ...history.map((message, index) => ({
      id: message.id,
      kind: 'recent_message' as const,
      text: `${message.role}: ${message.content}`,
      tokens: message.tokenEstimate ?? 0,
      recencyRank: history.length - 1 - index,
      pinned: false,
      source: {
        type: 'message' as const,
        messageId: message.id,
        conversationId: message.conversationId
      }
    })),
    ...notes.map((note) => ({
      id: note.id,
      kind: 'pinned_note' as const,
      text: `${note.title}\n\n${note.body}`,
      tokens: 0,
      pinned: true,
      source: { type: 'note' as const, noteId: note.id, title: note.title }
    })),
    ...hits.map((hit, index) => ({
      id: hit.id,
      kind: 'doc_chunk' as const,
      text: hit.text,
      tokens: hit.tokenEstimate ?? 0,
      similarity: 1 / (1 + index),
      recencyRank: index,
      pinned: false,
      source: {
        type: 'document' as const,
        docId: hit.documentId,
        filename: documents.get(hit.documentId)?.filename ?? 'unknown',
        chunkOrdinal: hit.ordinal,
        pageFrom: hit.pageFrom,
        pageTo: hit.pageTo
      }
    }))
  ]

  const assembled = assembleContext({
    budget: { modelLimit: 8192, reservedOutput: 1024, safetyMargin: 256 },
    candidates,
    query: query || 'Continue.'
  })

  return {
    request: { model: MODEL, messages: assembled.messages },
    report: assembled.report
  }
}

function toMatch(query: string): string {
  const terms = query
    .split(/[^\p{L}\p{N}_]+/u)
    .map((term) => term.trim())
    .filter(Boolean)
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ')
}
