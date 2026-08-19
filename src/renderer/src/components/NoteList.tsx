import { useState } from 'react'
import { useStore } from '../store'

export default function NoteList(): React.JSX.Element {
  const notes = useStore((s) => s.notes)
  const createNote = useStore((s) => s.createNote)
  const [title, setTitle] = useState('')

  return (
    <>
      <form
        className="flex shrink-0 items-center gap-2 border-b border-shell-line px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) return
          void createNote(title.trim(), '')
          setTitle('')
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New note title"
          aria-label="New note title"
          className="min-w-0 flex-1 rounded bg-black/30 px-2 py-1.5 text-sm placeholder:text-shell-muted"
        />
        <button
          type="submit"
          className="shrink-0 rounded bg-white/5 px-2 py-1.5 text-sm text-shell-muted hover:bg-white/10 hover:text-shell-text"
        >
          +
        </button>
      </form>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {notes.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-shell-muted">
            No notes yet. Pinned notes are always included in the prompt.
          </li>
        )}
        {notes.map((note) => (
          <li key={note.id} className="mx-1 rounded px-2 py-1.5 hover:bg-white/5">
            <div className="flex items-center gap-2">
              {note.pinned === 1 && (
                <span aria-label="Pinned" className="text-xs">
                  {' '}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
            </div>
            {note.body && (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-shell-muted">{note.body}</p>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
