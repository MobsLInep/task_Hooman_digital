import type { ChunkRepository, DocumentRepository, NoteRepository } from '../../persistence'
import type { AnyTool } from '../types'
import { createCalculatorTool } from './calculator'
import { createDatetimeTool } from './datetime'
import { createDocumentSearchTool } from './documentSearch'
import { createNotesSearchTool } from './notesSearch'

export * from './calculator'
export * from './datetime'
export * from './documentSearch'
export * from './notesSearch'

export interface ToolDeps {
  notes: (workspaceId: string) => NoteRepository
  chunks: (workspaceId: string) => ChunkRepository
  documents: (workspaceId: string) => DocumentRepository
  now?: () => Date
}

export function createDefaultTools(deps: ToolDeps): AnyTool[] {
  return [
    createCalculatorTool(),
    createNotesSearchTool(deps.notes),
    createDocumentSearchTool({
      chunks: deps.chunks,
      filenameOf: (workspaceId, documentId) =>
        deps.documents(workspaceId).find(documentId)?.filename
    }),
    createDatetimeTool(deps.now)
  ] as unknown as AnyTool[]
}
