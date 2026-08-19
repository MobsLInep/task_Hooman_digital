CREATE TABLE workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE conversations (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  model_id      TEXT,
  system_prompt TEXT,
  pinned        INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'complete'
                    CHECK (status IN ('pending', 'streaming', 'complete', 'error', 'cancelled')),
  token_estimate  INTEGER,
  provenance_json TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'ingesting', 'ready', 'error')),
  error        TEXT,
  page_count   INTEGER,
  created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_documents_workspace_sha ON documents(workspace_id, sha256);

CREATE TABLE chunks (
  id             TEXT PRIMARY KEY,
  document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ordinal        INTEGER NOT NULL,
  text           TEXT NOT NULL,
  token_estimate INTEGER,
  page_from      INTEGER,
  page_to        INTEGER,
  UNIQUE (document_id, ordinal)
);

CREATE TABLE notes (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  pinned       INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  updated_at   TEXT NOT NULL
);

CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  params_json      TEXT NOT NULL DEFAULT '{}',
  result_json      TEXT,
  error            TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  partial_json     TEXT,
  lease_expires_at TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE activity (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  summary      TEXT NOT NULL,
  meta_json    TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE providers (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  base_url       TEXT NOT NULL,
  model_id       TEXT,
  credential_ref TEXT,
  is_default     INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);

CREATE INDEX idx_conversations_workspace ON conversations(workspace_id, updated_at DESC);
CREATE INDEX idx_messages_workspace      ON messages(workspace_id);
CREATE INDEX idx_documents_workspace     ON documents(workspace_id, created_at DESC);
CREATE INDEX idx_chunks_workspace        ON chunks(workspace_id);
CREATE INDEX idx_notes_workspace         ON notes(workspace_id, updated_at DESC);
CREATE INDEX idx_tasks_workspace_status  ON tasks(workspace_id, status);
CREATE INDEX idx_activity_workspace      ON activity(workspace_id, created_at DESC);
CREATE INDEX idx_providers_workspace     ON providers(workspace_id);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  content = 'chunks',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER chunks_fts_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER chunks_fts_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER chunks_fts_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE VIRTUAL TABLE notes_fts USING fts5(
  body,
  content = 'notes',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;

CREATE TRIGGER notes_fts_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO notes_fts(rowid, body) VALUES (new.rowid, new.body);
END;
