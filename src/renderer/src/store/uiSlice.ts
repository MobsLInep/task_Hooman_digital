import type { StateCreator } from 'zustand'
import type { AppStore } from './index'

export type ListTab = 'conversations' | 'documents' | 'notes'

export interface UiSlice {
  listTab: ListTab
  inspectorOpen: boolean
  paletteOpen: boolean
  setListTab: (tab: ListTab) => void
  toggleInspector: () => void
  setPaletteOpen: (open: boolean) => void
}

export const createUiSlice: StateCreator<AppStore, [], [], UiSlice> = (set) => ({
  listTab: 'conversations',
  inspectorOpen: false,
  paletteOpen: false,

  setListTab(tab) {
    set({ listTab: tab })
  },
  toggleInspector() {
    set((state) => ({ inspectorOpen: !state.inspectorOpen }))
  },
  setPaletteOpen(open) {
    set({ paletteOpen: open })
  }
})
