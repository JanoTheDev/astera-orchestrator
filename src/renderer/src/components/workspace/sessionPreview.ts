// W7-F (#84): which History entry a plan tree row can preview once its tab is closed. Pure, tested in vitest's node env.
import type { Dispatch } from '../../../../core/orchestration/types'

/** The History entry id (`${accountId}:${sessionId}`, core HistoryEntry) of a session's transcript, or null when none is
 *  known. Only a worker has one: its Dispatch records the provider's own id (nativeSessionId), the latest Dispatch of
 *  the session that learned it winning. A planner or coordinator records none, so its row has nothing to preview. */
export function previewEntryIdOf(
  sessionId: string,
  dispatches: readonly Pick<Dispatch, 'sessionId' | 'accountId' | 'nativeSessionId' | 'startedAt'>[]
): string | null {
  const d = dispatches
    .filter((x) => x.sessionId === sessionId && x.nativeSessionId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .at(-1)
  return d ? `${d.accountId}:${d.nativeSessionId}` : null
}
