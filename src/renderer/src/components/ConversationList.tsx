import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'

export default function ConversationList(): React.JSX.Element {
  const conversations = useStore(useShallow((s) => s.filteredConversations()))
  const activeConversationId = useStore((s) => s.activeConversationId)
  const query = useStore((s) => s.conversationQuery)
  const setQuery = useStore((s) => s.setConversationQuery)
  const select = useStore((s) => s.selectConversation)
  const create = useStore((s) => s.createConversation)
  const rename = useStore((s) => s.renameConversation)
  const remove = useStore((s) => s.deleteConversation)
  const togglePinned = useStore((s) => s.togglePinned)
  const generating = useStore((s) => s.generating)

  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-shell-line px-3 py-2">
        <input
          id="conversation-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats  (Ctrl+K)"
          aria-label="Search conversations"
          className="min-w-0 flex-1 rounded bg-black/30 px-2 py-1.5 text-sm text-shell-text placeholder:text-shell-muted"
        />
        <button
          type="button"
          onClick={() => void create()}
          aria-label="New conversation (Ctrl+N)"
          title="New conversation (Ctrl+N)"
          className="shrink-0 rounded bg-white/5 px-2 py-1.5 text-sm text-shell-muted hover:bg-white/10 hover:text-shell-text"
        >
          +
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {conversations.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-shell-muted">
            {query ? 'No chats match that search.' : 'No chats yet — press Ctrl+N.'}
          </li>
        )}

        {conversations.map((conversation) => {
          const isActive = conversation.id === activeConversationId
          const isStreaming = generating[conversation.id] === true

          return (
            <li key={conversation.id}>
              <div
                className={[
                  'group mx-1 flex items-center gap-2 rounded px-2 py-1.5',
                  isActive ? 'bg-white/10' : 'hover:bg-white/5'
                ].join(' ')}
              >
                {editing === conversation.id ? (
                  <input
                    autoFocus
                    value={draft}
                    aria-label="Conversation title"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void rename(conversation.id, draft.trim() || conversation.title)
                        setEditing(null)
                      }
                      if (event.key === 'Escape') setEditing(null)
                    }}
                    className="min-w-0 flex-1 rounded bg-black/40 px-1.5 py-0.5 text-sm"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void select(conversation.id)}
                    onDoubleClick={() => {
                      setEditing(conversation.id)
                      setDraft(conversation.title)
                    }}
                    aria-current={isActive ? 'true' : undefined}
                    className="min-w-0 flex-1 truncate text-left text-sm"
                  >
                    {conversation.pinned === 1 && <span aria-label="Pinned"> </span>}
                    {conversation.title}
                  </button>
                )}

                {isStreaming && (
                  <span
                    aria-label="Generating"
                    title="Generating"
                    className="streaming-dot h-1.5 w-1.5 shrink-0 rounded-full bg-shell-accent"
                  />
                )}

                <button
                  type="button"
                  onClick={() => void togglePinned(conversation.id)}
                  aria-label={conversation.pinned === 1 ? 'Unpin conversation' : 'Pin conversation'}
                  className="shrink-0 text-xs text-shell-muted opacity-0 transition-opacity hover:text-shell-text focus-visible:opacity-100 group-hover:opacity-100"
                >
                  {conversation.pinned === 1 ? '★' : '☆'}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(conversation.id)}
                  aria-label="Delete conversation"
                  className="shrink-0 text-xs text-shell-muted opacity-0 transition-opacity hover:text-shell-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
