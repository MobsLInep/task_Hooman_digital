import { z } from 'zod'
import type { NoteRepository } from '../../persistence'
import { jsonSchemaOf } from '../registry'
import type { Tool, ToolContext } from '../types'

export const notesSearchArgs = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe('Words to search for. Lexical search, so prefer the words likely to appear.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe('Maximum notes to return. Defaults to 10.')
})

export type NotesSearchArgs = z.infer<typeof notesSearchArgs>

export interface NoteHit {
  noteId: string
  title: string
  snippet: string
  pinned: boolean
}

export interface NotesSearchResult {
  query: string
  matches: NoteHit[]
  note?: string
}

export type NoteRepositoryResolver = (workspaceId: string) => NoteRepository

export function createNotesSearchTool(
  resolve: NoteRepositoryResolver
): Tool<NotesSearchArgs, NotesSearchResult> {
  return {
    name: 'notes_search',
    description:
      "Search the current workspace's notes by keyword and return matching notes with a " +
      'short snippet. Searches only the active workspace; it cannot see other workspaces.',
    schema: notesSearchArgs,
    jsonSchema: () => jsonSchemaOf(notesSearchArgs),
    requiresWorkspace: true,

    async execute(args: NotesSearchArgs, ctx: ToolContext): Promise<NotesSearchResult> {
      const notes = resolve(ctx.workspaceId)
      const hits = notes.search(toMatchQuery(args.query), args.limit ?? 10)

      const matches: NoteHit[] = hits.map((hit) => ({
        noteId: hit.id,
        title: hit.title,
        snippet: snippet(hit.body, args.query),
        pinned: hit.pinned === 1
      }))

      return {
        query: args.query,
        matches,
        ...(matches.length === 0
          ? {
              note: 'No notes in this workspace matched. The search is lexical, so try other words.'
            }
          : {})
      }
    }
  }
}

export function toMatchQuery(query: string): string {
  const terms = query
    .split(/[^\p{L}\p{N}_]+/u)
    .map((term) => term.trim())
    .filter(Boolean)
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ')
}

export function snippet(body: string, query: string, radius = 160): string {
  const terms = query.split(/\s+/).filter(Boolean)
  const lower = body.toLowerCase()

  let at = -1
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase())
    if (found !== -1 && (at === -1 || found < at)) at = found
  }
  if (at === -1) return body.slice(0, radius * 2).trim()

  const start = Math.max(0, at - radius)
  const end = Math.min(body.length, at + radius)
  return `${start > 0 ? '…' : ''}${body.slice(start, end).trim()}${end < body.length ? '…' : ''}`
}
