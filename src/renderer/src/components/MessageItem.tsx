import { useStore } from '../store'
import { CitationRow } from './CitationChip'
import type { Message } from '../store/types'

function isPartial(message: Message): boolean {
  return message.status === 'cancelled' && message.content.length > 0
}

export default function MessageItem({ message }: { message: Message }): React.JSX.Element {
  const retry = useStore((s) => s.retry)
  const continueFrom = useStore((s) => s.continueFrom)
  const generating = useStore((s) => s.isGenerating(s.activeConversationId))

  const isUser = message.role === 'user'
  const partial = isPartial(message)

  return (
    <article
      className={[
        'group rounded-lg px-3 py-2',
        isUser ? 'bg-white/5' : 'bg-transparent',
        partial ? 'border-l-2 border-shell-warn pl-2.5' : ''
      ].join(' ')}
      aria-label={`${message.role} message`}
    >
      <header className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-shell-muted">
        <span>{message.role}</span>

        {partial && (
          <span className="rounded bg-shell-warn/15 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-shell-warn">
            partial — stopped before finishing
          </span>
        )}
        {message.status === 'error' && (
          <span className="rounded bg-shell-danger/15 px-1.5 py-0.5 text-[10px] normal-case text-shell-danger">
            failed
          </span>
        )}
        {message.prevMessageId && (
          <span
            title={`Regenerated from ${message.prevMessageId}`}
            className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] normal-case tracking-normal"
          >
            regenerated
          </span>
        )}
      </header>

      <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>

      <CitationRow provenanceJson={message.provenanceJson} />

      {message.role === 'assistant' && !generating && (
        <div className="mt-2 flex gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => void retry(message.id)}
            className="rounded border border-shell-line px-2 py-0.5 text-[11px] text-shell-muted hover:border-shell-accent hover:text-shell-text"
          >
            Retry
          </button>
          {partial && (
            <button
              type="button"
              onClick={() => void continueFrom(message.id)}
              className="rounded border border-shell-line px-2 py-0.5 text-[11px] text-shell-muted hover:border-shell-accent hover:text-shell-text"
            >
              Continue
            </button>
          )}
        </div>
      )}
    </article>
  )
}
