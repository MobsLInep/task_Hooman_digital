import type { StateCreator } from 'zustand'
import { api } from './api'
import type { AppStore } from './index'
import type { ActivityRow, DocumentRow, Note } from './types'

export interface LibrarySlice {
  documents: DocumentRow[]
  notes: Note[]
  activity: ActivityRow[]
  importing: boolean
  duplicatePrompt: { path: string; filename: string; existingId: string } | null

  loadDocuments: () => Promise<void>
  loadNotes: () => Promise<void>
  loadActivity: () => Promise<void>
  importDocuments: () => Promise<void>
  resolveDuplicate: (resolution: 'link-existing' | 'import-as-copy') => Promise<void>
  dismissDuplicate: () => void
  createNote: (title: string, body: string) => Promise<void>
}

interface ImportOutcome {
  path: string
  filename: string
  outcome:
    | { status: 'ready'; documentId: string; chunks: number; pageCount: number }
    | { status: 'failed'; reason: string; message: string }
    | { status: 'duplicate'; existingDocumentId: string; filename: string; sha256: string }
}

export const createLibrarySlice: StateCreator<AppStore, [], [], LibrarySlice> = (set, get) => ({
  documents: [],
  notes: [],
  activity: [],
  importing: false,
  duplicatePrompt: null,

  async loadDocuments() {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return
    set({ documents: await api.documents.list<DocumentRow[]>(workspaceId) })
  },

  async loadNotes() {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return
    set({ notes: await api.notes.list<Note[]>(workspaceId) })
  },

  async loadActivity() {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return
    set({ activity: await api.activity.recent<ActivityRow[]>(workspaceId, 50) })
  },

  async importDocuments() {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return

    set({ importing: true })
    try {
      const results = await api.documents.import<ImportOutcome[]>(workspaceId)

      const duplicate = results.find(
        (result: ImportOutcome) => result.outcome.status === 'duplicate'
      )
      if (duplicate && duplicate.outcome.status === 'duplicate') {
        set({
          duplicatePrompt: {
            path: duplicate.path,
            filename: duplicate.filename,
            existingId: duplicate.outcome.existingDocumentId
          }
        })
      }
      await get().loadDocuments()
    } finally {
      set({ importing: false })
    }
  },

  async resolveDuplicate(resolution) {
    const prompt = get().duplicatePrompt
    const workspaceId = get().activeWorkspaceId
    if (!prompt || !workspaceId) return

    await api.documents.resolveDuplicate(workspaceId, prompt.path, resolution)
    set({ duplicatePrompt: null })
    await get().loadDocuments()
  },

  dismissDuplicate() {
    set({ duplicatePrompt: null })
  },

  async createNote(title, body) {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return
    await api.notes.create(workspaceId, title, body)
    await get().loadNotes()
  }
})
