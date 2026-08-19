ALTER TABLE messages
  ADD COLUMN prev_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX idx_messages_prev ON messages(prev_message_id);
