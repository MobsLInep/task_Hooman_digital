-- @foreign-keys-off

CREATE TABLE documents_new (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,
  mime           TEXT NOT NULL,
  sha256         TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'parsing', 'ready', 'failed')),
  failure_reason TEXT
                   CHECK (failure_reason IS NULL OR failure_reason IN (
                     'unsupported_type', 'too_large', 'empty_file', 'encrypted',
                     'no_text_layer', 'malformed', 'parse_timeout',
                     'worker_crashed', 'unknown'
                   )),
  error          TEXT,
  page_count     INTEGER,
  parsed_at      TEXT,
  created_at     TEXT NOT NULL,
  CHECK ((status = 'failed') = (failure_reason IS NOT NULL))
);

INSERT INTO documents_new
  (id, workspace_id, filename, mime, sha256, size_bytes, status, failure_reason,
   error, page_count, parsed_at, created_at)
SELECT
  id, workspace_id, filename, mime, sha256, size_bytes,
  CASE status
    WHEN 'ingesting' THEN 'parsing'
    WHEN 'error'     THEN 'failed'
    ELSE status
  END,
  CASE WHEN status = 'error' THEN 'unknown' ELSE NULL END,
  error, page_count, NULL, created_at
FROM documents;

DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;

CREATE INDEX idx_documents_workspace_sha ON documents(workspace_id, sha256);
CREATE INDEX idx_documents_workspace ON documents(workspace_id, created_at DESC);
CREATE INDEX idx_documents_status ON documents(workspace_id, status);
