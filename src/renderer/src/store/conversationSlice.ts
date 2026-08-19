import type { StateCreator } from 'zustand'
import { api } from './api'
import type { AppStore } from './index'
import type { Conversation } from './types'

export interface ConversationSlice {
  conversations: Conversation[]
  activeConversationId: string | null
  conversationQuery: string

  loadConversations: () => Promise<void>
  selectConversation: (conversationId: string | null) => Promise<void>
  createConversation: (title?: string) => Promise<string | undefined>
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  togglePinned: (id: string) => Promise<void>
  setConversationQuery: (query: string) => void
  filteredConversations: () => Conversation[]
}

export const createConversationSlice: StateCreator<AppStore, [], [], ConversationSlice> = (
  set,
  get
) => ({
  conversations: [],
  activeConversationId: null,
  conversationQuery: '',

  async loadConversations() {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return
    set({ conversations: await api.conversations.list<Conversation[]>(workspaceId) })
  },

  async selectConversation(conversationId) {
    set({ activeConversationId: conversationId })
    if (conversationId) await get().openConversation(conversationId)
  },

  async createConversation(title = 'New conversation') {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return undefined

    const conversation = await api.conversations.create<Conversation>(workspaceId, title)
    set((state) => ({ conversations: [conversation, ...state.conversations] }))
    await get().selectConversation(conversation.id)
    return conversation.id
  },

  async renameConversation(id, title) {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return
    await api.conversations.rename(workspaceId, id, title)
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, title } : c))
    }))
  },

  async deleteConversation(id) {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return
    await api.conversations.remove(workspaceId, id)
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId: state.activeConversationId === id ? null : state.activeConversationId
    }))
  },

  async togglePinned(id) {
    const workspaceId = get().activeWorkspaceId
    const conversation = get().conversations.find((c) => c.id === id)
    if (!workspaceId || !conversation) return

    const pinned = conversation.pinned === 1 ? 0 : 1
    await api.conversations.setPinned(workspaceId, id, pinned === 1)
    set((state) => ({
      conversations: state.conversations
        .map((c) => (c.id === id ? { ...c, pinned: pinned as 0 | 1 } : c))
        .sort((a, b) => b.pinned - a.pinned || b.updatedAt.localeCompare(a.updatedAt))
    }))
  },

  setConversationQuery(query) {
    set({ conversationQuery: query })
  },

  filteredConversations() {
    const { conversations, conversationQuery } = get()
    const query = conversationQuery.trim().toLowerCase()
    if (!query) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(query))
  }
})
