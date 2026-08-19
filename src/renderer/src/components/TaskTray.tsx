import { useStore } from '../store'

export default function TaskTray(): React.JSX.Element | null {
  const open = useStore((s) => s.trayOpen)
  const tasks = useStore((s) => s.tasks)
  const toggleTray = useStore((s) => s.toggleTray)
  const openTask = useStore((s) => s.openTask)
  const generating = useStore((s) => s.generating)
  const conversations = useStore((s) => s.conversations)
  const selectConversation = useStore((s) => s.selectConversation)

  if (!open) return null

  const streams = Object.entries(generating)
    .filter(([, isGenerating]) => isGenerating)
    .map(([conversationId]) => ({
      conversationId,
      title: conversations.find((c) => c.id === conversationId)?.title ?? conversationId
    }))

  const empty = tasks.length === 0 && streams.length === 0

  return (
    <div
      role="dialog"
      aria-label="Running tasks"
      className="absolute bottom-3 left-16 z-20 w-80 overflow-hidden rounded-lg border border-shell-line bg-shell-panel shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-shell-line px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-shell-muted">
          Running now
        </h2>
        <button
          type="button"
          onClick={toggleTray}
          aria-label="Close tasks"
          className="text-shell-muted hover:text-shell-text"
        >
          ✕
        </button>
      </header>

      <ul className="max-h-72 overflow-y-auto py-1">
        {empty && (
          <li className="px-3 py-5 text-center text-xs text-shell-muted">Nothing running.</li>
        )}

        {streams.map((stream) => (
          <li key={stream.conversationId}>
            <button
              type="button"
              onClick={() => void selectConversation(stream.conversationId)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
            >
              <span className="streaming-dot h-1.5 w-1.5 shrink-0 rounded-full bg-shell-accent" />
              <span className="min-w-0 flex-1 truncate">{stream.title}</span>
              <span className="shrink-0 text-[11px] text-shell-muted">generating</span>
            </button>
          </li>
        ))}

        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => void openTask(task)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-shell-warn" />
              <span className="min-w-0 flex-1 truncate">
                {task.type}
                <span className="ml-1.5 text-[11px] text-shell-muted">{task.workspaceName}</span>
              </span>
              <span className="shrink-0 text-[11px] text-shell-muted">{task.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
