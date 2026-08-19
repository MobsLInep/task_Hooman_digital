import WorkspaceRail from './WorkspaceRail'
import ListColumn from './ListColumn'
import MainPane from './MainPane'
import PromptInspector from './PromptInspector'
import TaskTray from './TaskTray'
import CommandPalette from './CommandPalette'
import DuplicateDialog from './DuplicateDialog'
import { useStore } from '../store'

export default function AppShell(): React.JSX.Element {
  const inspectorOpen = useStore((s) => s.inspectorOpen)

  return (
    <div className="flex h-full w-full overflow-hidden bg-shell-bg text-shell-text">
      <WorkspaceRail />
      <ListColumn />
      <MainPane />
      {inspectorOpen && <PromptInspector />}
      <TaskTray />
      <CommandPalette />
      <DuplicateDialog />
    </div>
  )
}
