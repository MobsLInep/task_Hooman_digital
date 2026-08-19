import { useState } from 'react'

export default function ToolCallCard({
  name,
  args,
  durationMs,
  outcome
}: {
  name: string
  args?: unknown
  durationMs?: number
  outcome?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const tone =
    outcome === undefined || outcome === 'ok'
      ? 'text-shell-muted'
      : outcome === 'validation_error'
        ? 'text-shell-warn'
        : 'text-shell-danger'

  return (
    <div className="my-1.5 overflow-hidden rounded border border-shell-line bg-black/20">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-white/5"
      >
        <span aria-hidden className="text-shell-accent">
          {open ? '▾' : '▸'}
        </span>
        <span className="font-medium">{name}</span>
        {outcome && <span className={tone}>{outcome.replace(/_/g, ' ')}</span>}
        <span className="flex-1" />
        {durationMs !== undefined && (
          <span className="text-[11px] text-shell-muted">{durationMs}ms</span>
        )}
      </button>

      {open && (
        <pre className="max-h-48 overflow-auto border-t border-shell-line px-2.5 py-2 text-[11px] leading-relaxed text-shell-muted">
          {typeof args === 'string' ? args : JSON.stringify(args, null, 2)}
        </pre>
      )}
    </div>
  )
}
