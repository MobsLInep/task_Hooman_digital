import { useEffect } from 'react'
import { useStore } from '../store'

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const store = useStore.getState()
      const mod = event.ctrlKey || event.metaKey

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        store.setPaletteOpen(true)
        return
      }

      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void store.createConversation()
        return
      }

      if (event.key === 'Escape') {
        if (store.paletteOpen) {
          store.setPaletteOpen(false)
          return
        }
        if (store.duplicatePrompt) {
          store.dismissDuplicate()
          return
        }
        if (store.trayOpen) {
          store.toggleTray()
          return
        }

        const visible = store.activeConversationId
        if (visible && store.isGenerating(visible)) {
          event.preventDefault()
          void store.cancel(visible)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
