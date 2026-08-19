import type { StateCreator } from 'zustand'
import { api } from './api'
import type { AppStore } from './index'
import type { AppEvent, ContextReport, GenerationSnapshot, Message } from './types'

export interface ChatSlice {
  messages: Message[]
  streaming: Record<string, string>
  generating: Record<string, boolean>
  toolCalls: Record<string, { id: string; name: string; args: unknown }[]>
  lastError: string | null
  report: ContextReport | null

  openConversation: (conversationId: string) => Promise<void>
  loadMessages: () => Promise<void>
  send: (text: string) => Promise<void>
  cancel: (conversationId?: string) => Promise<void>
  retry: (messageId: string) => Promise<void>
  continueFrom: (messageId: string) => Promise<void>
  loadReport: () => Promise<void>
  applyEvent: (event: AppEvent) => void
  isGenerating: (conversationId: string | null) => boolean
  activeStreamText: () => string
}

export const createChatSlice: StateCreator<AppStore, [], [], ChatSlice> = (set, get) => ({
  messages: [],
  streaming: {},
  generating: {},
  toolCalls: {},
  lastError: null,
  report: null,

  async openConversation(conversationId) {
    const snapshot = await api.generation.snapshot<GenerationSnapshot>(conversationId)

    set((state) => ({
      streaming: { ...state.streaming, [conversationId]: snapshot.text },
      generating: { ...state.generating, [conversationId]: snapshot.generating },
      toolCalls: { ...state.toolCalls, [conversationId]: snapshot.toolCalls },
      lastError: snapshot.lastError ?? null
    }))

    await Promise.all([get().loadMessages(), get().loadReport()])
  },

  async loadMessages() {
    const { activeWorkspaceId, activeConversationId } = get()
    if (!activeWorkspaceId || !activeConversationId) {
      set({ messages: [] })
      return
    }
    set({ messages: await api.messages.list<Message[]>(activeWorkspaceId, activeConversationId) })
  },

  async send(text) {
    const { activeWorkspaceId, activeConversationId } = get()
    if (!activeWorkspaceId || !activeConversationId || !text.trim()) return

    set({ lastError: null })
    await api.generation.send(activeWorkspaceId, activeConversationId, text.trim())
    await get().loadMessages()
  },

  async cancel(conversationId) {
    const target = conversationId ?? get().activeConversationId
    if (!target) return
    await api.generation.cancel(target)
  },

  async retry(messageId) {
    const { activeWorkspaceId, activeConversationId } = get()
    if (!activeWorkspaceId || !activeConversationId) return
    set({ lastError: null })
    await api.generation.retry(activeWorkspaceId, activeConversationId, messageId)
  },

  async continueFrom(messageId) {
    const { activeWorkspaceId, activeConversationId } = get()
    if (!activeWorkspaceId || !activeConversationId) return
    set({ lastError: null })
    await api.generation.continue(activeWorkspaceId, activeConversationId, messageId)
  },

  async loadReport() {
    const conversationId = get().activeConversationId
    if (!conversationId) {
      set({ report: null })
      return
    }
    set({ report: await api.generation.report<ContextReport | null>(conversationId) })
  },

  applyEvent(event) {
    switch (event.type) {
      case 'delta':
        set((state) => ({
          streaming: {
            ...state.streaming,
            [event.conversationId]: (state.streaming[event.conversationId] ?? '') + event.text
          }
        }))
        break

      case 'tool_call':
        set((state) => ({
          toolCalls: {
            ...state.toolCalls,
            [event.conversationId]: [...(state.toolCalls[event.conversationId] ?? []), event.call]
          }
        }))
        break

      case 'state':
        set((state) => ({
          generating: { ...state.generating, [event.conversationId]: event.generating },

          streaming: event.generating
            ? { ...state.streaming, [event.conversationId]: '' }
            : state.streaming
        }))
        break

      case 'settled': {
        set((state) => ({
          generating: { ...state.generating, [event.conversationId]: false },
          streaming: { ...state.streaming, [event.conversationId]: '' },
          toolCalls: { ...state.toolCalls, [event.conversationId]: [] },
          lastError:
            event.conversationId === state.activeConversationId
              ? (event.error ?? null)
              : state.lastError
        }))

        if (event.conversationId === get().activeConversationId) {
          void get().loadMessages()
          void get().loadReport()
        }
        void get().loadConversations()
        break
      }

      default:
        break
    }
  },

  isGenerating(conversationId) {
    return conversationId ? (get().generating[conversationId] ?? false) : false
  },

  activeStreamText() {
    const id = get().activeConversationId
    return id ? (get().streaming[id] ?? '') : ''
  }
})
