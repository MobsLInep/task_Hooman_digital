import { useStore } from '../store'
import type { DocumentRow } from '../store/types'

function StatusPill({ document }: { document: DocumentRow }): React.JSX.Element {
  const tone =
    document.status === 'ready'
      ? 'bg-shell-ok/15 text-shell-ok'
      : document.status === 'failed'
        ? 'bg-shell-danger/15 text-shell-danger'
        : 'bg-shell-warn/15 text-shell-warn'

  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
      {document.status === 'failed' && document.failureReason
        ? document.failureReason.replace(/_/g, ' ')
        : document.status}
    </span>
  )
}

export default function DocumentList(): React.JSX.Element {
  const documents = useStore((s) => s.documents)
  const importDocuments = useStore((s) => s.importDocuments)
  const importing = useStore((s) => s.importing)

  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-shell-line px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-shell-muted">
          {documents.length} document{documents.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          disabled={importing}
          onClick={() => void importDocuments()}
          className="rounded bg-white/5 px-2 py-1 text-xs text-shell-muted hover:bg-white/10 hover:text-shell-text disabled:opacity-50"
        >
          {importing ? 'Importing…' : 'Import…'}
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {documents.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-shell-muted">
            No documents yet. PDF, Markdown and plain text, up to 25 MB.
          </li>
        )}

        {documents.map((document) => (
          <li key={document.id} className="mx-1 rounded px-2 py-1.5 hover:bg-white/5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm" title={document.filename}>
                {document.filename}
              </span>
              <StatusPill document={document} />
            </div>
            <div className="mt-0.5 text-[11px] text-shell-muted">
              {document.status === 'failed' && document.error
                ? document.error
                : `${document.pageCount ?? '—'} pages · ${Math.round(document.sizeBytes / 1024)} KB`}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
