import { z } from 'zod'

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  createdAt: z.iso.datetime()
})

export type Workspace = z.infer<typeof workspaceSchema>

export const workspaceDraftSchema = workspaceSchema.omit({ id: true, createdAt: true })
export type WorkspaceDraft = z.infer<typeof workspaceDraftSchema>
