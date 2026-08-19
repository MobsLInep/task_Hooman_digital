import { useStore } from '../store'

export function CitationChip({
  documentId,
  filename,
  pageFrom,
  pageTo
}: {
  documentId: string
  filename: string
  pageFrom?: number | null
  pageTo?: number | null
}): React.JSX.Element {
  const setListTab = useStore((s) => s.setListTab)

  const pages =
    pageFrom == null && pageTo == null
      ? ''
      : pageFrom != null && pageTo != null && pageFrom !== pageTo
        ? ` pp. ${pageFrom}–${pageTo}`
        : ` p. ${pageFrom ?? pageTo}`

  return (
    <button
      type="button"
      onClick={() => setListTab('documents')}
      title={`${filename}${pages} (${documentId})`}
      aria-label={`Open source ${filename}${pages}`}
      className="inline-flex max-w-[16rem] items-center gap-1 rounded border border-shell-line bg-white/5 px-1.5 py-0.5 text-[11px] text-shell-muted transition-colors hover:border-shell-accent hover:text-shell-text"
    >
      <span aria-hidden>◆</span>
      <span className="truncate">{filename}</span>
      {pages && <span className="shrink-0 text-shell-accent">{pages.trim()}</span>}
    </button>
  )
}

export function CitationRow({
  provenanceJson
}: {
  provenanceJson: string | null
}): React.JSX.Element | null {
  if (!provenanceJson) return null

  let sources: {
    docId?: string
    filename?: string
    pageFrom?: number | null
    pageTo?: number | null
  }[] = []
  try {
    const parsed = JSON.parse(provenanceJson) as { sources?: typeof sources }
    sources = parsed.sources ?? []
  } catch {
    return null
  }
  if (sources.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((source, index) => (
        <CitationChip
          key={`${source.docId}-${index}`}
          documentId={source.docId ?? ''}
          filename={source.filename ?? 'source'}
          pageFrom={source.pageFrom ?? null}
          pageTo={source.pageTo ?? null}
        />
      ))}
    </div>
  )
}
