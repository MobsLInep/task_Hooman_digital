import type { StateCreator } from 'zustand'
import { api } from './api'
import type { AppStore } from './index'
import type { ActiveTask } from './types'

export interface TaskSlice {
  tasks: ActiveTask[]
  trayOpen: boolean
  refreshTasks: () => Promise<void>
  toggleTray: () => void
  openTask: (task: ActiveTask) => Promise<void>
  taskBadge: () => number
}

export const createTaskSlice: StateCreator<AppStore, [], [], TaskSlice> = (set, get) => ({
  tasks: [],
  trayOpen: false,

  async refreshTasks() {
    set({ tasks: await api.tasks.active<ActiveTask[]>() })
  },

  toggleTray() {
    set((state) => ({ trayOpen: !state.trayOpen }))
    if (get().trayOpen) void get().refreshTasks()
  },

  async openTask(task) {
    if (task.workspaceId !== get().activeWorkspaceId) {
      await get().selectWorkspace(task.workspaceId)
    }
    set({ trayOpen: false })
  },

  taskBadge() {
    const generating = Object.values(get().generating).filter(Boolean).length
    return get().tasks.length + generating
  }
})
