import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import MessageItem from './MessageItem'
import ToolCallCard from './ToolCallCard'

export default function MainPane(): React.JSX.Element {
  const activeConversationId = useStore((s) => s.activeConversationId)
  const conversations = useStore((s) => s.conversations)
  const messages = useStore((s) => s.messages)
  const streamText = useStore((s) => s.activeStreamText())
  const generating = useStore((s) => s.isGenerating(s.activeConversationId))

  const toolCalls = useStore(
    useShallow((s) => (s.activeConversationId ? (s.toolCalls[s.activeConversationId] ?? []) : []))
  )
  const lastError = useStore((s) => s.lastError)
  const send = useStore((s) => s.send)
  const cancel = useStore((s) => s.cancel)
  const toggleInspector = useStore((s) => s.toggleInspector)
  const inspectorOpen = useStore((s) => s.inspectorOpen)

  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  const conversation = conversations.find((c) => c.id === activeConversationId)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streamText])

  if (!activeConversationId) {
    return (
      <main aria-label="Conversation" className="flex min-w-0 flex-1 items-center justify-center">
        <p className="max-w-sm text-center text-sm text-shell-muted">
          Select a conversation, or press <kbd className="rounded bg-white/10 px-1">Ctrl</kbd>+
          <kbd className="rounded bg-white/10 px-1">N</kbd> to start one.
        </p>
      </main>
    )
  }

  return (
    <main aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-shell-line px-4">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {conversation?.title ?? 'Conversation'}
        </h1>

        {generating && (
          <span className="flex items-center gap-1.5 text-xs text-shell-accent" aria-live="polite">
            <span className="streaming-dot h-1.5 w-1.5 rounded-full bg-shell-accent" />
            streaming
          </span>
        )}

        <button
          type="button"
          onClick={toggleInspector}
          aria-pressed={inspectorOpen}
          className="rounded border border-shell-line px-2 py-1 text-[11px] text-shell-muted hover:border-shell-accent hover:text-shell-text"
        >
          Inspector
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {messages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}

          {toolCalls.map((call) => (
            <ToolCallCard key={call.id} name={call.name} args={call.args} />
          ))}

          {}
          {generating && (
            <article className="rounded-lg px-3 py-2" aria-label="assistant message in progress">
              <header className="mb-1 text-[11px] uppercase tracking-wider text-shell-muted">
                assistant
              </header>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {streamText}
                <span className="streaming-dot ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-shell-accent" />
              </div>
            </article>
          )}

          {lastError && (
            <div
              role="alert"
              className="rounded border border-shell-danger/40 bg-shell-danger/10 px-3 py-2 text-sm text-shell-danger"
            >
              {lastError}
            </div>
          )}

          <div ref={bottom} />
        </div>
      </div>

      <form
        className="shrink-0 border-t border-shell-line p-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return
          void send(draft)
          setDraft('')
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!draft.trim()) return
                void send(draft)
                setDraft('')
              }
            }}
            rows={2}
            aria-label="Message"
            placeholder="Send a message…  (Esc cancels a running generation)"
            className="min-h-[3rem] flex-1 resize-none rounded bg-black/30 px-3 py-2 text-sm placeholder:text-shell-muted"
          />

          {generating ? (
            <button
              type="button"
              onClick={() => void cancel()}
              className="shrink-0 rounded bg-shell-danger/20 px-3 py-2 text-sm text-shell-danger hover:bg-shell-danger/30"
            >
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              className="shrink-0 rounded bg-shell-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </main>
  )
}
