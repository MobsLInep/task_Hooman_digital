import type { SqlDatabase } from './database'
import {
  ActivityRepository,
  ChunkRepository,
  ConversationRepository,
  DocumentRepository,
  MessageRepository,
  NoteRepository,
  ProviderRepository,
  TaskRepository,
  WorkspaceRepository
} from './repositories'

export class WorkspaceRepositories {
  readonly workspace: WorkspaceRepository
  readonly conversations: ConversationRepository
  readonly messages: MessageRepository
  readonly documents: DocumentRepository
  readonly chunks: ChunkRepository
  readonly notes: NoteRepository
  readonly tasks: TaskRepository
  readonly activity: ActivityRepository
  readonly providers: ProviderRepository

  constructor(
    db: SqlDatabase,
    readonly workspaceId: string
  ) {
    this.workspace = new WorkspaceRepository(db, workspaceId)
    this.conversations = new ConversationRepository(db, workspaceId)
    this.messages = new MessageRepository(db, workspaceId)
    this.documents = new DocumentRepository(db, workspaceId)
    this.chunks = new ChunkRepository(db, workspaceId)
    this.notes = new NoteRepository(db, workspaceId)
    this.tasks = new TaskRepository(db, workspaceId)
    this.activity = new ActivityRepository(db, workspaceId)
    this.providers = new ProviderRepository(db, workspaceId)
  }
}
