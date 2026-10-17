import { useEffect, useState } from 'react'
import type { Account, SessionInfo } from '../../../../core/types'
import type { WorkspaceSession } from './workspaceTree'
import { useAttention } from './useAttention'
import { sessionStatusOf } from './WorkspaceSidebar'
import './workspace.css'

/** The focused plan session's facts, above the pane grid: project, plan, task, model, account, cwd, branch, status.
 *  The branch is the worktree registry's for the session's folder; a worker in the project folder itself (the
 *  concurrency-1 placement) is on whatever that checkout is on, which the registry does not know. */
export function WorkspaceHeader({
  session,
  info,
  accounts
}: {
  session: WorkspaceSession
  info: SessionInfo | undefined
  accounts: Account[]
}): React.JSX.Element {
  const cwd = info?.cwd ?? session.cwd
  const [branch, setBranch] = useState<string | null>(null)
  useEffect(() => {
    setBranch(null)
    if (!cwd) return
    let alive = true
    void window.api.worktrees
      .list()
      .then((list) => alive && setBranch(list.find((w) => w.path === cwd)?.branch ?? null))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [cwd])
  const status = sessionStatusOf(info, useAttention([session.sessionId])[session.sessionId])
  const accountId = info?.accountId ?? session.accountId
  const account = accounts.find((a) => a.id === accountId)
  const facts: Array<[string, string | undefined]> = [
    ['Project', session.projectName],
    ['Plan', session.planName],
    ['Task', session.taskTitle ?? session.label],
    ['Model', session.model ?? info?.model],
    ['Account', account?.label ?? accountId],
    ['cwd', cwd],
    ['Branch', branch ?? undefined],
    ['Status', status]
  ]
  return (
    <div className="ws-header" aria-label={session.label}>
      {facts.map(([k, v]) => (
        <span key={k} className="ws-fact" title={v}>
          <span className="ws-fact-key">{k}</span> {v ?? '—'}
        </span>
      ))}
    </div>
  )
}
