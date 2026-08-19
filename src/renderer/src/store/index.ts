import { create } from 'zustand'
import { createWorkspaceSlice, type WorkspaceSlice } from './workspaceSlice'
import { createConversationSlice, type ConversationSlice } from './conversationSlice'
import { createChatSlice, type ChatSlice } from './chatSlice'
import { createLibrarySlice, type LibrarySlice } from './librarySlice'
import { createTaskSlice, type TaskSlice } from './taskSlice'
import { createUiSlice, type UiSlice } from './uiSlice'

export type AppStore = WorkspaceSlice &
  ConversationSlice &
  ChatSlice &
  LibrarySlice &
  TaskSlice &
  UiSlice

export const useStore = create<AppStore>()((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createConversationSlice(...a),
  ...createChatSlice(...a),
  ...createLibrarySlice(...a),
  ...createTaskSlice(...a),
  ...createUiSlice(...a)
}))

export * from './types'
