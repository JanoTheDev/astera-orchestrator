// W9-B: the facts the top bar, the status bar and the placeholder Inbox share, read once for all three.
import { useMemo } from 'react'
import { buildSessionIndex, needsInput } from '../../../../core/orchestration/sessionIndex'
import { useAttention } from '../../state/useAttention'
import { useHostWaiting } from '../search/useHostWaiting'
import { useAccountUsage } from '../../hooks/useAccountUsage'
import type { AppState } from '../../state/appState'
import { activeAccountOf, nextQueuedLine, shellCounts } from './shellView'

export type ShellDeps = Pick<AppState, 'accounts' | 'active' | 'sessions' | 't' | 'workspaceData' | 'workspaceTree'>

export function useShell({ accounts, active, sessions, t, workspaceData, workspaceTree }: ShellDeps) {
  const attention = useAttention(sessions.map((s) => s.id))
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
  const counts = shellCounts(sessions, attention, needsYou)
  const nextQueued = workspaceData
    ? nextQueuedLine({ jobs: Object.values(workspaceData.jobsByProject).flat(), runs: workspaceData.runs, tasks: workspaceData.tasks }, t)
    : null
  const accountUsage = useAccountUsage()
  const shellAccount = activeAccountOf(accounts, active?.accountId)
  return { attention, sessionIndex, needsYou, counts, nextQueued, shellAccount, shellUsage: shellAccount ? accountUsage[shellAccount.configDir] : undefined }
}

export type ShellState = ReturnType<typeof useShell>
