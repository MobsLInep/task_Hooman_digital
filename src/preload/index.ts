import { contextBridge, ipcRenderer } from 'electron'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const EVENT_CHANNEL = 'app:event'

const api = {
  getVersion: (): Promise<string> => invoke('app:getVersion'),

  workspaces: {
    list: <T>(): Promise<T> => invoke('workspaces:list'),
    create: <T>(name: string): Promise<T> => invoke('workspaces:create', name)
  },

  conversations: {
    list: <T>(workspaceId: string): Promise<T> => invoke('conversations:list', workspaceId),
    create: <T>(workspaceId: string, title: string): Promise<T> =>
      invoke('conversations:create', workspaceId, title),
    rename: (workspaceId: string, id: string, title: string): Promise<boolean> =>
      invoke('conversations:rename', workspaceId, id, title),
    remove: (workspaceId: string, id: string): Promise<boolean> =>
      invoke('conversations:delete', workspaceId, id),
    setPinned: (workspaceId: string, id: string, pinned: boolean): Promise<boolean> =>
      invoke('conversations:setPinned', workspaceId, id, pinned)
  },

  messages: {
    list: <T>(workspaceId: string, conversationId: string): Promise<T> =>
      invoke('messages:list', workspaceId, conversationId)
  },

  notes: {
    list: <T>(workspaceId: string): Promise<T> => invoke('notes:list', workspaceId),
    create: <T>(workspaceId: string, title: string, body: string): Promise<T> =>
      invoke('notes:create', workspaceId, title, body),
    update: (workspaceId: string, id: string, title: string, body: string): Promise<boolean> =>
      invoke('notes:update', workspaceId, id, title, body),
    remove: (workspaceId: string, id: string): Promise<boolean> =>
      invoke('notes:delete', workspaceId, id)
  },

  documents: {
    list: <T>(workspaceId: string): Promise<T> => invoke('documents:list', workspaceId),
    import: <T>(workspaceId: string): Promise<T> => invoke('documents:import', workspaceId),
    resolveDuplicate: <T>(
      workspaceId: string,
      path: string,
      resolution: 'link-existing' | 'import-as-copy'
    ): Promise<T> => invoke('documents:resolveDuplicate', workspaceId, path, resolution),
    chunks: <T>(workspaceId: string, documentId: string): Promise<T> =>
      invoke('documents:chunks', workspaceId, documentId)
  },

  tasks: {
    active: <T>(): Promise<T> => invoke('tasks:active')
  },

  activity: {
    recent: <T>(workspaceId: string, limit: number): Promise<T> =>
      invoke('activity:recent', workspaceId, limit)
  },

  generation: {
    send: <T>(workspaceId: string, conversationId: string, text: string): Promise<T> =>
      invoke('generation:send', workspaceId, conversationId, text),
    retry: <T>(
      workspaceId: string,
      conversationId: string,
      previousMessageId: string
    ): Promise<T> => invoke('generation:retry', workspaceId, conversationId, previousMessageId),
    continue: <T>(
      workspaceId: string,
      conversationId: string,
      partialMessageId: string
    ): Promise<T> => invoke('generation:continue', workspaceId, conversationId, partialMessageId),
    cancel: (conversationId: string): Promise<boolean> =>
      invoke('generation:cancel', conversationId),
    snapshot: <T>(conversationId: string): Promise<T> =>
      invoke('generation:snapshot', conversationId),
    active: <T>(): Promise<T> => invoke('generation:active'),
    report: <T>(conversationId: string): Promise<T> => invoke('generation:report', conversationId)
  },

  inspector: {
    tools: <T>(): Promise<T> => invoke('inspector:tools')
  },

  onEvent: (listener: (event: unknown) => void): (() => void) => {
    const handler = (_event: unknown, payload: unknown): void => listener(payload)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, handler)
    }
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
