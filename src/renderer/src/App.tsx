import { useEffect } from 'react'
import AppShell from './components/AppShell'
import { useStore } from './store'
import { api } from './store/api'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import type { AppEvent } from './store/types'

export default function App(): React.JSX.Element {
  const loadWorkspaces = useStore((s) => s.loadWorkspaces)
  const applyEvent = useStore((s) => s.applyEvent)
  const refreshTasks = useStore((s) => s.refreshTasks)
  const loadDocuments = useStore((s) => s.loadDocuments)

  useKeyboardShortcuts()

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    const unsubscribe = api.onEvent((raw) => {
      const event = raw as AppEvent
      applyEvent(event)

      if (event.type === 'documents:changed') void loadDocuments()
      if (event.type === 'state' || event.type === 'settled' || event.type === 'tasks:changed') {
        void refreshTasks()
      }
    })
    return unsubscribe
  }, [applyEvent, loadDocuments, refreshTasks])

  return <AppShell />
}
