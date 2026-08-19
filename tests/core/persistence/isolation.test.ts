import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  assertScoped,
  WorkspaceDirectory,
  WorkspaceRepositories,
  WorkspaceScopeError,
  type SqlDatabase
} from '@core/persistence'
import { migratedDb } from './helpers'

describe('workspace isolation', () => {
  let db: Database.Database & SqlDatabase
  let a: WorkspaceRepositories
  let b: WorkspaceRepositories

  beforeEach(() => {
    db = migratedDb()
    const directory = new WorkspaceDirectory(db)
    directory.create('ws-a', 'Workspace A')
    directory.create('ws-b', 'Workspace B')
    a = new WorkspaceRepositories(db, 'ws-a')
    b = new WorkspaceRepositories(db, 'ws-b')
  })

  it('cannot read another workspace conversation, even by exact id', () => {
    const theirs = b.conversations.create({ id: 'conv-b', title: 'B secret' })
    a.conversations.create({ id: 'conv-a', title: 'A only' })

    expect(theirs.workspaceId).toBe('ws-b')

    expect(a.conversations.find('conv-b')).toBeUndefined()
    expect(a.conversations.list().map((c) => c.id)).toEqual(['conv-a'])

    expect(b.conversations.find('conv-b')).toBeDefined()
  })

  it('cannot read another workspace messages via a foreign conversation id', () => {
    b.conversations.create({ id: 'conv-b', title: 'B' })
    b.messages.append({ id: 'msg-b', conversationId: 'conv-b', role: 'user', content: 'B secret' })

    expect(a.messages.listByConversation('conv-b')).toEqual([])
    expect(a.messages.find('msg-b')).toBeUndefined()
    expect(b.messages.listByConversation('conv-b')).toHaveLength(1)
  })

  it.each([
    ['documents', (r: WorkspaceRepositories) => r.documents.find('doc-b')],
    ['notes', (r: WorkspaceRepositories) => r.notes.find('note-b')],
    ['tasks', (r: WorkspaceRepositories) => r.tasks.find('task-b')],
    ['providers', (r: WorkspaceRepositories) => r.providers.find('prov-b')]
  ])('cannot read another workspace %s by id', (_label, read) => {
    b.documents.create({
      id: 'doc-b',
      filename: 'b.pdf',
      mime: 'application/pdf',
      sha256: 'b'.repeat(64),
      sizeBytes: 10
    })
    b.notes.create({ id: 'note-b', title: 'B note', body: 'B body' })
    b.tasks.enqueue({ id: 'task-b', type: 'ingest' })
    b.providers.create({ id: 'prov-b', name: 'B node', baseUrl: 'http://b.example' })

    expect(read(a)).toBeUndefined()
    expect(read(b)).toBeDefined()
  })

  it('cannot write into another workspace row', () => {
    b.notes.create({ id: 'note-b', title: 'B note', body: 'B body' })

    expect(a.notes.update('note-b', 'hijacked', 'hijacked')).toBe(false)
    expect(a.notes.delete('note-b')).toBe(false)
    expect(b.notes.find('note-b')!.title).toBe('B note')
  })

  it('cannot claim another workspace queued task', () => {
    b.tasks.enqueue({ id: 'task-b', type: 'ingest' })

    expect(a.tasks.claim()).toBeUndefined()
    expect(b.tasks.claim()!.id).toBe('task-b')
  })

  it('scopes a workspace to its own row only', () => {
    expect(a.workspace.self()!.name).toBe('Workspace A')
    expect(b.workspace.self()!.name).toBe('Workspace B')

    a.workspace.rename('Renamed A')
    expect(b.workspace.self()!.name).toBe('Workspace B')
  })

  it('caller parameters cannot override the bound workspaceId', () => {
    b.notes.create({ id: 'note-b', title: 'B note' })

    const injected = a.notes as unknown as {
      get<T>(sql: string, params: Record<string, string>): T | undefined
    }
    const stolen = injected.get(
      'SELECT id FROM notes WHERE workspace_id = @workspaceId AND id = @id',
      { id: 'note-b', workspaceId: 'ws-b' }
    )

    expect(stolen).toBeUndefined()
  })
})

describe('full-text search', () => {
  let db: Database.Database & SqlDatabase
  let a: WorkspaceRepositories
  let b: WorkspaceRepositories

  beforeEach(() => {
    db = migratedDb()
    const directory = new WorkspaceDirectory(db)
    directory.create('ws-a', 'A')
    directory.create('ws-b', 'B')
    a = new WorkspaceRepositories(db, 'ws-a')
    b = new WorkspaceRepositories(db, 'ws-b')
  })

  it('matches chunk text within the workspace and never outside it', () => {
    for (const [repo, ws] of [
      [a, 'a'],
      [b, 'b']
    ] as const) {
      repo.documents.create({
        id: `doc-${ws}`,
        filename: `${ws}.txt`,
        mime: 'text/plain',
        sha256: ws.repeat(64),
        sizeBytes: 100
      })
      repo.chunks.insert({
        id: `chunk-${ws}`,
        documentId: `doc-${ws}`,
        ordinal: 0,
        text: `the peregrine falcon dives in workspace ${ws}`
      })
    }

    const hits = a.chunks.search('peregrine')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.id).toBe('chunk-a')
    expect(hits[0]!.workspaceId).toBe('ws-a')

    expect(b.chunks.search('peregrine').map((h) => h.id)).toEqual(['chunk-b'])
  })

  it('matches note bodies within the workspace only', () => {
    a.notes.create({ id: 'note-a', title: 'A', body: 'quarterly budget for kestrels' })
    b.notes.create({ id: 'note-b', title: 'B', body: 'quarterly budget for ospreys' })

    expect(a.notes.search('quarterly').map((n) => n.id)).toEqual(['note-a'])
    expect(a.notes.search('ospreys')).toEqual([])
  })

  it('keeps the FTS index in step with updates and deletes', () => {
    a.notes.create({ id: 'note-a', title: 'A', body: 'original wording' })
    expect(a.notes.search('original')).toHaveLength(1)

    a.notes.update('note-a', 'A', 'replacement wording')
    expect(a.notes.search('original')).toEqual([])
    expect(a.notes.search('replacement')).toHaveLength(1)

    a.notes.delete('note-a')
    expect(a.notes.search('replacement')).toEqual([])
  })

  it('leaves no orphaned FTS rows when a workspace is cascade-deleted', () => {
    a.documents.create({
      id: 'doc-a',
      filename: 'a.txt',
      mime: 'text/plain',
      sha256: 'a'.repeat(64),
      sizeBytes: 1
    })
    a.chunks.insert({ id: 'chunk-a', documentId: 'doc-a', ordinal: 0, text: 'vanishing content' })
    a.notes.create({ id: 'note-a', title: 'A', body: 'vanishing note' })

    new WorkspaceDirectory(db).delete('ws-a')

    expect(db.prepare('SELECT count(*) AS n FROM chunks').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM notes').get()).toEqual({ n: 0 })

    expect(
      db.prepare(`SELECT count(*) AS n FROM chunks_fts WHERE chunks_fts MATCH 'vanishing'`).get()
    ).toEqual({ n: 0 })
    expect(
      db.prepare(`SELECT count(*) AS n FROM notes_fts WHERE notes_fts MATCH 'vanishing'`).get()
    ).toEqual({ n: 0 })
  })
})

describe('assertScoped', () => {
  it('accepts statements that constrain themselves to one workspace', () => {
    expect(() =>
      assertScoped('SELECT id FROM notes WHERE workspace_id = @workspaceId')
    ).not.toThrow()
    expect(() =>
      assertScoped('SELECT id FROM notes WHERE n.workspace_id=@workspaceId')
    ).not.toThrow()
    expect(() =>
      assertScoped('SELECT id FROM workspaces WHERE workspaces.id = @workspaceId')
    ).not.toThrow()
    expect(() =>
      assertScoped('INSERT INTO notes (id, workspace_id) VALUES (@id, @workspaceId)')
    ).not.toThrow()
  })

  it('rejects a query that forgot the workspace predicate', () => {
    expect(() => assertScoped('SELECT id FROM notes')).toThrow(WorkspaceScopeError)
    expect(() => assertScoped('SELECT id FROM notes WHERE id = @id')).toThrow(WorkspaceScopeError)
    expect(() => assertScoped('DELETE FROM notes')).toThrow(WorkspaceScopeError)

    expect(() => assertScoped(`SELECT id FROM notes WHERE workspace_id = 'ws-b'`)).toThrow(
      WorkspaceScopeError
    )
  })

  it('rejects an INSERT that does not carry workspace_id', () => {
    expect(() => assertScoped('INSERT INTO notes (id, title) VALUES (@id, @title)')).toThrow(
      WorkspaceScopeError
    )
  })

  it('is reachable through a repository, not merely as a helper', () => {
    const db = migratedDb()
    new WorkspaceDirectory(db).create('ws-a', 'A')
    const repo = new WorkspaceRepositories(db, 'ws-a').notes as unknown as {
      all<T>(sql: string): T[]
    }

    expect(() => repo.all('SELECT id FROM notes')).toThrow(WorkspaceScopeError)
  })
})
