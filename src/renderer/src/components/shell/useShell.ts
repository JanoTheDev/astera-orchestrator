// W9-B: the facts the top bar, the status bar and the placeholder Inbox share, read once for all three.
import { useMemo } from 'react'
import { buildSessionIndex, needsInput } from '../../../../core/orchestration/sessionIndex'
import { useAttention } from '../../state/useAttention'
import { useNeedsYou } from '../inbox/useNeedsYou'
import { useHostWaiting } from '../search/useHostWaiting'
import { useConsoleSnapshot } from '../wall/consoleStore'
import { useAccountUsage } from '../../hooks/useAccountUsage'
import { useAccountPlans } from '../../hooks/useAccountPlans'
import type { AppState } from '../../state/appState'
import { scopeSessions } from '../../state/projectView'
import { activeAccountOf, nextQueuedLine, shellCounts } from './shellView'

export type ShellDeps = Pick<AppState, 'accounts' | 'active' | 'sessions' | 't' | 'workspaceData' | 'workspaceTree' | 'workspaceIds' | 'scopeId' | 'scopedTree' | 'scopedData'>

export function useShell({ accounts, active, sessions: allSessions, t, workspaceIds, scopeId, scopedTree: workspaceTree, scopedData: workspaceData, ...wide }: ShellDeps) {
  // T19: the status bar's "needs you" is the bell's own unread count (one selector, inbox/useNeedsYou.ts)
  const { unread: needsYouUnread } = useNeedsYou({ scopedData: workspaceData, scopedTree: workspaceTree, workspaceData: wide.workspaceData, workspaceTree: wide.workspaceTree }, false)
  const attention = useAttention(allSessions.map((s) => s.id))
  // the Agents view's consoles (AgentsPage publishes them): the badge counts the same list the pane shows
  const { consoles } = useConsoleSnapshot()
  // W5-D (#42): the Host's own waits, read with the app closed too
  const hostWaiting = useHostWaiting(workspaceData?.projects[0]?.path ?? null)
  const { sessionIndex, needsYou } = useMemo(() => {
    const input = {
      tree: workspaceTree,
      jobs: Object.values(workspaceData?.jobsByProject ?? {}).flat(),
      runs: workspaceData?.runs ?? [],
      tasks: workspaceData?.tasks ?? [],
      gates: workspaceData?.gates ?? [],
      escalations: workspaceData?.escalations ?? [], // W6-B
      projects: workspaceData?.projects ?? [], // #117
      attention,
      hostWaiting
    }
    const sessionIndex = buildSessionIndex(input)
    return { sessionIndex, needsYou: needsInput(input, sessionIndex) }
  }, [workspaceTree, workspaceData, attention, hostWaiting])
  // The status bar counts the open project's work; "All projects" widens it
  const counts = shellCounts(scopeSessions(allSessions, workspaceIds, scopeId), attention, needsYou, consoles)
  const nextQueued = workspaceData
    ? nextQueuedLine({ jobs: Object.values(workspaceData.jobsByProject).flat(), runs: workspaceData.runs, tasks: workspaceData.tasks }, t)
    : null
  const accountUsage = useAccountUsage()
  const shellAccount = activeAccountOf(accounts, active?.accountId)
  // T6: the shown account's plan, so the status bar draws no "5h" for an account with no 5-hour window
  const shellPlan = useAccountPlans(shellAccount ? [shellAccount] : [])[shellAccount?.id ?? '']
  return { attention, sessionIndex, needsYou, needsYouUnread, counts, nextQueued, shellAccount, shellPlan, shellUsage: shellAccount ? accountUsage[shellAccount.configDir] : undefined }
}

export type ShellState = ReturnType<typeof useShell>
