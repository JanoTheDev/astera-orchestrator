// The Explorer side bar view (DESIGN-W13 §4): the project's Files and, below, the Changed files. Both read the one git
// status; each pane's header carries its actions.
import { FileExplorer } from '../FileExplorer'
import { ChangedList } from '../ChangedList'
import { useGitStatus } from '../../hooks/useGitStatus'
import { ViewContainer, ViewPane } from '../ui'
import type { SideBarViewProps } from '../shell/SideBar'

export function ExplorerView(p: SideBarViewProps): React.JSX.Element {
  const {
    t, currentProject, openProjectFile, explorerTreesRef, explorerClipboardRef, explorerUndoRef, handlePathRenamed, handlePathDeleted,
    runFile, newTerminal, explorerReveal, setExplorerReveal
  } = p
  const gitStatus = useGitStatus(currentProject)
  return (
    <div className="wb-view">
      <ViewContainer label={t('explorer.title')}>
        <FileExplorer
          root={currentProject}
          onOpenFile={openProjectFile}
          gitStatus={gitStatus}
          stateRef={explorerTreesRef}
          clipboardRef={explorerClipboardRef}
          undoRef={explorerUndoRef}
          onPathRenamed={handlePathRenamed}
          onPathDeleted={handlePathDeleted}
          onRunFile={runFile}
          onOpenTerminal={(dir) => void newTerminal(undefined, dir)}
          revealFolder={explorerReveal}
          onRevealDone={(seq) => setExplorerReveal((r) => (r !== null && r.seq === seq ? null : r))}
        />
        {currentProject && (
          <ViewPane
            title={t('explorer.view.changed')}
            count={Object.keys(gitStatus.fileState).length}
            storageKey="explorer.changed"
            className="fx-changed-pane"
          >
            <ChangedList root={currentProject} gitStatus={gitStatus} onOpenFile={openProjectFile} />
          </ViewPane>
        )}
      </ViewContainer>
    </div>
  )
}
