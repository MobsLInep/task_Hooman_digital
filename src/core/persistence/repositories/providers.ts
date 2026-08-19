import type { SqlDatabase } from '../database'
import { WorkspaceScopedRepository } from './base'
import type { ProviderRow, SqlBool } from './types'

const COLUMNS = `id,
       workspace_id   AS workspaceId,
       name,
       base_url       AS baseUrl,
       model_id       AS modelId,
       credential_ref AS credentialRef,
       is_default     AS isDefault`

export interface NewProvider {
  id: string
  name: string
  baseUrl: string
  modelId?: string | null
  credentialRef?: string | null
}

export class ProviderRepository extends WorkspaceScopedRepository {
  constructor(db: SqlDatabase, workspaceId: string) {
    super(db, workspaceId)
  }

  list(): ProviderRow[] {
    return this.all<ProviderRow>(
      `SELECT ${COLUMNS} FROM providers WHERE workspace_id = @workspaceId ORDER BY name`
    )
  }

  find(id: string): ProviderRow | undefined {
    return this.get<ProviderRow>(
      `SELECT ${COLUMNS} FROM providers WHERE workspace_id = @workspaceId AND id = @id`,
      { id }
    )
  }

  getDefault(): ProviderRow | undefined {
    return this.get<ProviderRow>(
      `SELECT ${COLUMNS} FROM providers WHERE workspace_id = @workspaceId AND is_default = 1`
    )
  }

  create(provider: NewProvider): ProviderRow {
    this.run(
      `INSERT INTO providers
         (id, workspace_id, name, base_url, model_id, credential_ref, is_default)
       VALUES (@id, @workspaceId, @name, @baseUrl, @modelId, @credentialRef, 0)`,
      {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        modelId: provider.modelId ?? null,
        credentialRef: provider.credentialRef ?? null
      }
    )
    return this.find(provider.id)!
  }

  setDefault(id: string): boolean {
    this.run(
      `UPDATE providers SET is_default = 0 WHERE workspace_id = @workspaceId AND id <> @id`,
      { id }
    )
    return (
      this.run(
        `UPDATE providers SET is_default = @isDefault WHERE workspace_id = @workspaceId AND id = @id`,
        { id, isDefault: 1 satisfies SqlBool }
      ) > 0
    )
  }

  delete(id: string): boolean {
    return (
      this.run(`DELETE FROM providers WHERE workspace_id = @workspaceId AND id = @id`, { id }) > 0
    )
  }
}
