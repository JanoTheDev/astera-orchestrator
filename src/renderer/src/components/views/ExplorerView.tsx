// The Explorer side bar view (DESIGN-W13 §4). Adapter until its own Task: the file explorer, as the Files page had it;
// its close button hides the side bar.
import { FileExplorer } from '../FileExplorer'
import type { SideBarViewProps } from '../shell/SideBar'

export function ExplorerView(p: SideBarViewProps): React.JSX.Element {
  return (
    <div className="wb-view">
      <FileExplorer
        root={p.currentProject}
        onOpenFile={p.openProjectFile}
        onClose={() => p.setSidebarOpen(false)}
        stateRef={p.explorerTreesRef}
        clipboardRef={p.explorerClipboardRef}
        undoRef={p.explorerUndoRef}
        onPathRenamed={p.handlePathRenamed}
        onPathDeleted={p.handlePathDeleted}
        onRunFile={p.runFile}
        revealFolder={p.explorerReveal}
        onRevealDone={(seq) => p.setExplorerReveal((r) => (r !== null && r.seq === seq ? null : r))}
      />
    </div>
  )
}
