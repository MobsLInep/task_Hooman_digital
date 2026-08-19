import type { StateCreator } from 'zustand'
import { api } from './api'
import type { AppStore } from './index'
import type { Workspace } from './types'

export interface WorkspaceSlice {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  loadWorkspaces: () => Promise<void>
  createWorkspace: (name: string) => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
}

export const createWorkspaceSlice: StateCreator<AppStore, [], [], WorkspaceSlice> = (set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,

  async loadWorkspaces() {
    const workspaces = await api.workspaces.list<Workspace[]>()
    set({ workspaces })
    if (!get().activeWorkspaceId && workspaces[0]) {
      await get().selectWorkspace(workspaces[0].id)
    }
  },

  async createWorkspace(name) {
    const workspace = await api.workspaces.create<Workspace>(name)
    set((state) => ({ workspaces: [...state.workspaces, workspace] }))
    await get().selectWorkspace(workspace.id)
  },

  async selectWorkspace(workspaceId) {
    set({ activeWorkspaceId: workspaceId, activeConversationId: null })
    await Promise.all([
      get().loadConversations(),
      get().loadDocuments(),
      get().loadNotes(),
      get().refreshTasks()
    ])
  }
})
