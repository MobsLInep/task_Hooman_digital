import { useStore } from '../store'
import ConversationList from './ConversationList'
import DocumentList from './DocumentList'
import NoteList from './NoteList'
import type { ListTab } from '../store/uiSlice'

const TABS: { id: ListTab; label: string }[] = [
  { id: 'conversations', label: 'Chats' },
  { id: 'documents', label: 'Docs' },
  { id: 'notes', label: 'Notes' }
]

export default function ListColumn(): React.JSX.Element {
  const listTab = useStore((s) => s.listTab)
  const setListTab = useStore((s) => s.setListTab)

  return (
    <section
      aria-label="Library"
      className="flex w-72 shrink-0 flex-col border-r border-shell-line bg-shell-list"
    >
      <div
        role="tablist"
        aria-label="Library sections"
        className="flex h-12 shrink-0 border-b border-shell-line"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={listTab === tab.id}
            onClick={() => setListTab(tab.id)}
            className={[
              'flex-1 text-xs font-semibold uppercase tracking-wider transition-colors',
              listTab === tab.id
                ? 'border-b-2 border-shell-accent text-shell-text'
                : 'text-shell-muted hover:text-shell-text'
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        {listTab === 'conversations' && <ConversationList />}
        {listTab === 'documents' && <DocumentList />}
        {listTab === 'notes' && <NoteList />}
      </div>
    </section>
  )
}
