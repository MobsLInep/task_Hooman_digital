import { useState } from 'react'
import { useStore } from '../store'

export default function WorkspaceRail(): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const createWorkspace = useStore((s) => s.createWorkspace)
  const toggleTray = useStore((s) => s.toggleTray)
  const badge = useStore((s) => s.taskBadge())

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  return (
    <nav
      aria-label="Workspaces"
      className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-shell-line bg-shell-rail py-3"
    >
      {workspaces.map((workspace) => {
        const isActive = workspace.id === activeWorkspaceId
        return (
          <button
            key={workspace.id}
            type="button"
            title={workspace.name}
            aria-label={`Switch to ${workspace.name}`}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => void selectWorkspace(workspace.id)}
            className={[
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold transition-colors',
              isActive
                ? 'bg-shell-accent text-white'
                : 'bg-white/5 text-shell-muted hover:bg-white/10 hover:text-shell-text'
            ].join(' ')}
          >
            {workspace.name.slice(0, 1).toUpperCase()}
          </button>
        )
      })}

      {creating ? (
        <input
          autoFocus
          aria-label="New workspace name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setCreating(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) {
              void createWorkspace(name.trim())
              setName('')
              setCreating(false)
            }
            if (event.key === 'Escape') setCreating(false)
          }}
          className="w-10 rounded bg-white/10 px-1 py-1 text-center text-xs"
        />
      ) : (
        <button
          type="button"
          aria-label="Create workspace"
          title="Create workspace"
          onClick={() => setCreating(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-lg text-shell-muted hover:bg-white/10 hover:text-shell-text"
        >
          +
        </button>
      )}

      <div className="flex-1" />

      <button
        type="button"
        aria-label={`Tasks${badge > 0 ? ` (${badge} running)` : ''}`}
        title="Tasks"
        onClick={toggleTray}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-shell-muted hover:bg-white/10 hover:text-shell-text"
      >
        <span aria-hidden>⣿</span>
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-shell-accent px-1 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
      </button>
    </nav>
  )
}
