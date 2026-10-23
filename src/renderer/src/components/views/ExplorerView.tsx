// The Explorer side bar view (DESIGN-W13 §4): the project's Files and, below, the Changed files. Both read the one git
// status; each pane's header carries its actions.
import { FileExplorer } from '../FileExplorer'
import { ChangedList } from '../ChangedList'
import { useGitStatus } from '../../hooks/useGitStatus'
import { ViewContainer, ViewPane } from '../ui'
import type { SideBarViewProps } from '../shell/SideBar'

export function ExplorerView(p: SideBarViewProps): React.JSX.Element {
  const { t, currentProject: root } = p
  const gitStatus = useGitStatus(root)
  return (
    <div className="wb-view">
      <ViewContainer label={t('explorer.title')}>
        <FileExplorer
          root={root}
          onOpenFile={p.openProjectFile}
          gitStatus={gitStatus}
          stateRef={p.explorerTreesRef}
          clipboardRef={p.explorerClipboardRef}
          undoRef={p.explorerUndoRef}
          onPathRenamed={p.handlePathRenamed}
          onPathDeleted={p.handlePathDeleted}
          onRunFile={p.runFile}
          revealFolder={p.explorerReveal}
          onRevealDone={(seq) => p.setExplorerReveal((r) => (r !== null && r.seq === seq ? null : r))}
        />
        {root && (
          <ViewPane
            title={t('explorer.view.changed')}
            count={Object.keys(gitStatus.fileState).length}
            storageKey="explorer.changed"
            className="fx-changed-pane"
          >
            <ChangedList root={root} gitStatus={gitStatus} onOpenFile={p.openProjectFile} />
          </ViewPane>
        )}
      </ViewContainer>
    </div>
  )
}
