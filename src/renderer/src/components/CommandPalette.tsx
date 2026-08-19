import { useState } from 'react'
import { useStore } from '../store'

export default function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen)
  return open ? <PaletteBody /> : null
}

function PaletteBody(): React.JSX.Element {
  const setOpen = useStore((s) => s.setPaletteOpen)
  const conversations = useStore((s) => s.conversations)
  const select = useStore((s) => s.selectConversation)
  const create = useStore((s) => s.createConversation)

  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const matches = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center bg-black/50 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Search conversations"
        className="w-[32rem] max-w-[90vw] overflow-hidden rounded-lg border border-shell-line bg-shell-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          aria-label="Search conversations"
          placeholder="Search conversations…"
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((i) => Math.min(i + 1, matches.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            }
            if (event.key === 'Enter') {
              const target = matches[index]
              if (target) void select(target.id)
              else if (query.trim()) void create(query.trim())
              setOpen(false)
            }
          }}
          className="w-full border-b border-shell-line bg-transparent px-4 py-3 text-sm outline-none placeholder:text-shell-muted"
        />

        <ul className="max-h-80 overflow-y-auto py-1">
          {matches.length === 0 && (
            <li className="px-4 py-4 text-sm text-shell-muted">
              {query.trim() ? `Press Enter to create “${query.trim()}”` : 'No conversations yet.'}
            </li>
          )}
          {matches.map((conversation, i) => (
            <li key={conversation.id}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  void select(conversation.id)
                  setOpen(false)
                }}
                className={[
                  'flex w-full items-center gap-2 px-4 py-2 text-left text-sm',
                  i === index ? 'bg-white/10' : 'hover:bg-white/5'
                ].join(' ')}
              >
                {conversation.pinned === 1 && <span aria-hidden> </span>}
                <span className="truncate">{conversation.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
