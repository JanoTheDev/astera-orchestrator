// The History side bar view (DESIGN-W13 §4). Adapter until its own Task: past sessions (HistoryBrowser) and the work
// records ("How it works", UnderstandingView), each in a pane.
import { HistoryBrowser } from '../HistoryBrowser'
import { UnderstandingView } from '../UnderstandingView'
import { ViewContainer, ViewPane } from '../ui'
import type { SideBarViewProps } from '../shell/SideBar'

export function HistoryView(p: SideBarViewProps): React.JSX.Element {
  const { t, currentProject, understanding, openTasks } = p
  return (
    <ViewContainer label={t('shell.activity.history')}>
      <HistoryBrowser accounts={p.accounts} ghostAccounts={p.ghostAccounts} defaultSessionKind={p.defaultSessionKind} onResume={p.resumeFromHistory} />
      <ViewPane title={t('shell.history.records')} storageKey="history.records">
        <UnderstandingView
          // only the current project's: right after a switch the cache still holds the previous project's records
          understanding={understanding?.root === currentProject ? understanding.data : null}
          selectedRecordId={p.activeRecordId}
          onOpenRecord={p.openRecordTab}
          onRegenerate={(id) => currentProject && p.regenerateRecord(currentProject, id)}
          openTasks={openTasks?.root === currentProject ? openTasks.data : []}
          onCompleteTask={(id) => currentProject && p.completeOpenTask(currentProject, id)}
          onCancelTask={(id) => currentProject && p.cancelOpenTask(currentProject, id)}
        />
      </ViewPane>
    </ViewContainer>
  )
}
