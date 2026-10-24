// The History side bar view (DESIGN-W13 §4). Adapter until its own Task: past sessions (HistoryBrowser) and the work
// records ("How it works", UnderstandingView), each in a pane.
import { useMemo } from 'react'
import { HistoryBrowser } from '../HistoryBrowser'
import { sessionFactsOf } from '../historyTree'
import { projectOfCwd } from '../../state/workspaceTree'
import { UnderstandingView } from '../UnderstandingView'
import { ViewContainer, ViewPane } from '../ui'
import type { SideBarViewProps } from '../shell/SideBar'

export function HistoryView(p: SideBarViewProps): React.JSX.Element {
  const { t, currentProject, understanding, openTasks, sessions, attention, workspaceData } = p
  const factsOf = useMemo(
    () =>
      sessionFactsOf({
        sessions,
        attention,
        dispatches: workspaceData?.dispatches ?? [],
        tasks: workspaceData?.tasks ?? [],
        runs: workspaceData?.runs ?? [],
        jobs: Object.values(workspaceData?.jobsByProject ?? {}).flat()
      }),
    [sessions, attention, workspaceData]
  )
  // shortcut: a session counts for the folder it was started in, compared as written; normalize if a trailing slash or
  // case difference ever leaves a live project unsorted
  const liveIn = useMemo(() => {
    const n = new Map<string, number>()
    for (const s of sessions) if (s.status === 'running') n.set(s.cwd, (n.get(s.cwd) ?? 0) + 1)
    return (path: string) => n.get(path) ?? 0
  }, [sessions])
  return (
    <ViewContainer label={t('shell.activity.history')}>
      <ViewPane title={t('shell.history.sessions')} storageKey="history.sessions">
        <HistoryBrowser asPage accounts={p.accounts} ghostAccounts={p.ghostAccounts} defaultSessionKind={p.defaultSessionKind}
          scopeId={p.scopeId}
          ownerOf={(path) => projectOfCwd(path, p.workspaceTree, p.workspaceData?.worktrees ?? [])}
          factsOf={factsOf}
          liveIn={liveIn}
          onResume={p.resumeFromHistory} />
      </ViewPane>
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
