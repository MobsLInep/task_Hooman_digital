import { create } from 'zustand'

export interface ShellState {
  activeWorkspaceId: string | null
  selectedItemId: string | null
  setActiveWorkspace: (id: string) => void
  setSelectedItem: (id: string | null) => void
}

export const useShellStore = create<ShellState>((set) => ({
  activeWorkspaceId: null,
  selectedItemId: null,
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id, selectedItemId: null }),
  setSelectedItem: (id) => set({ selectedItemId: id })
}))
