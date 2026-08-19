import { useStore } from '../store'

export default function DuplicateDialog(): React.JSX.Element | null {
  const prompt = useStore((s) => s.duplicatePrompt)
  const resolve = useStore((s) => s.resolveDuplicate)
  const dismiss = useStore((s) => s.dismissDuplicate)

  if (!prompt) return null

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-label="Duplicate document"
        className="w-[26rem] max-w-[90vw] rounded-lg border border-shell-line bg-shell-panel p-4 shadow-2xl"
      >
        <h2 className="text-sm font-medium">Already imported</h2>
        <p className="mt-2 text-sm text-shell-muted">
          <span className="text-shell-text">{prompt.filename}</span> has exactly the same contents
          as a document already in this workspace.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded border border-shell-line px-3 py-1.5 text-sm text-shell-muted hover:text-shell-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void resolve('import-as-copy')}
            className="rounded border border-shell-line px-3 py-1.5 text-sm hover:border-shell-accent"
          >
            Import as copy
          </button>
          <button
            type="button"
            onClick={() => void resolve('link-existing')}
            className="rounded bg-shell-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            Use existing
          </button>
        </div>
      </div>
    </div>
  )
}
