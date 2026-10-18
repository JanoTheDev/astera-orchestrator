import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Attention, SessionInfo } from '../../../../core/types'
import { planSessions, type WorkspaceData, type WorkspacePlan, type WorkspaceProject, type WorkspaceSession } from './workspaceTree'
import { useAttention } from './useAttention'
import { buildSessionIndex, needsInput } from '../../../../core/orchestration/sessionIndex'
import { SessionSearch } from '../search/SessionSearch'
import { useHostWaiting } from '../search/useHostWaiting'
import './workspace.css'

/** The status word of a session row and header: exited when its process is gone, else its attention. */
export const sessionStatusOf = (info: SessionInfo | undefined, attention: Attention | undefined): string =>
  info === undefined ? 'not open' : info.status === 'exited' ? 'exited' : (attention ?? 'idle')

const GROUPS: Array<[keyof Pick<WorkspacePlan, 'planner' | 'coordinator' | 'workers'>, string]> = [
  ['planner', 'Planner'],
  ['coordinator', 'Coordinator'],
  ['workers', 'Workers']
]

/** W2-B: Projects → Plans → that plan's sessions. Clicking a plan opens its workspace (the pane grid showing only
 *  its sessions); clicking a session focuses its live terminal. */
export function WorkspaceSidebar({
  tree,
  data,
  sessions,
  showArchived,
  onShowArchived,
  selectedPlanId,
  onSelectPlan,
  canOpenSession,
  onOpenSession
}: {
  tree: WorkspaceProject[]
  /** W3-C: what the tree was built from, for search and the "needs my input" list. */
  data: WorkspaceData | null
  sessions: SessionInfo[]
  showArchived: boolean
  onShowArchived: (v: boolean) => void
  selectedPlanId: string | null
  onSelectPlan: (jobId: string | null) => void
  canOpenSession: (sessionId: string) => boolean
  /** Focuses the session in its plan's workspace. */
  onOpenSession: (sessionId: string, jobId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  // Collapsed rather than expanded, so a plan made while the app is open shows up unfolded
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const toggle = (id: string): void =>
    setFolded((f) => {
      const next = new Set(f)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const infoOf = new Map(sessions.map((s) => [s.id, s]))
  const attention = useAttention(tree.flatMap((p) => p.plans.flatMap((plan) => planSessions(plan).map((s) => s.sessionId))))
  // W3-C search and "needs my input" (core/orchestration/sessionIndex.ts)
  const [inboxOpen, setInboxOpen] = useState(false)
  // W5-D (#42): and the Host's own waits, which it read with the app closed too
  const hostWaiting = useHostWaiting(data?.projects[0]?.path ?? null)
  const { index, inbox } = useMemo(() => {
    const input = {
      tree,
      jobs: Object.values(data?.jobsByProject ?? {}).flat(),
      runs: data?.runs ?? [],
      tasks: data?.tasks ?? [],
      gates: data?.gates ?? [],
      escalations: data?.escalations ?? [], // W6-B
      attention,
      hostWaiting
    }
    const index = buildSessionIndex(input)
    return { index, inbox: needsInput(input, index) }
  }, [tree, data, attention, hostWaiting])

  const sessionRow = (plan: WorkspacePlan) => (s: WorkspaceSession): React.JSX.Element => {
    const status = sessionStatusOf(infoOf.get(s.sessionId), attention[s.sessionId])
    const openable = canOpenSession(s.sessionId)
    return (
      <li key={s.sessionId}>
        <button
          className="ws-row ws-session"
          disabled={!openable}
          title={[s.taskTitle, s.model, s.cwd].filter(Boolean).join(' · ')}
          onClick={() => onOpenSession(s.sessionId, plan.jobId)}
        >
          <span className={`ws-dot ws-${status.replace(' ', '-')}`} aria-label={status} />
          <span className="ws-name">{s.label}</span>
          {s.taskTitle && <span className="ws-sub">{s.taskTitle}</span>}
        </button>
      </li>
    )
  }

  return (
    <section className="worktree-panel workspace-panel">
      <header className="panel-header">
        <button className="panel-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Workspaces
        </button>
        <button
          className={`ss-badge${inbox.length > 0 ? ' ss-due' : ''}`}
          title="Needs my input: sessions at a prompt, open questions, escalations, plans awaiting approval"
          aria-label={`${inbox.length} need your input`}
          aria-pressed={inboxOpen}
          onClick={() => {
            setOpen(true)
            setInboxOpen((v) => !v)
          }}
        >
          {inbox.length}
        </button>
        <div className="panel-actions">
          {selectedPlanId && (
            <button className="ws-link" title="Show every session again" onClick={() => onSelectPlan(null)}>
              All sessions
            </button>
          )}
          <label className="ws-archived">
            <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchived(e.target.checked)} /> Archived
          </label>
        </div>
      </header>
      {open && (
        <SessionSearch
          index={index}
          inbox={inbox}
          showInbox={inboxOpen}
          canOpenSession={canOpenSession}
          onOpenSession={onOpenSession}
          onSelectPlan={onSelectPlan}
        />
      )}
      {open && (
        <ul className="ws-tree">
          {tree.length === 0 && <li className="ws-empty">No projects yet</li>}
          {tree.map((p) => (
            <li key={p.id}>
              <button className="ws-row ws-project" title={p.path} onClick={() => toggle(p.id)}>
                {folded.has(p.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="ws-name">{p.name}</span>
              </button>
              {!folded.has(p.id) && (
                <ul className="ws-plans">
                  {p.plans.length === 0 && <li className="ws-empty">No plans</li>}
                  {p.plans.map((plan) => (
                    <li key={plan.jobId}>
                      <div className={`ws-row ws-plan${plan.jobId === selectedPlanId ? ' selected' : ''}`}>
                        <button className="ws-chevron" aria-label="Expand" onClick={() => toggle(plan.jobId)}>
                          {folded.has(plan.jobId) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        </button>
                        <button
                          className="ws-name ws-plan-name"
                          title={plan.jobId === selectedPlanId ? 'Show every session again' : 'Open this plan’s workspace'}
                          onClick={() => onSelectPlan(plan.jobId === selectedPlanId ? null : plan.jobId)}
                        >
                          {plan.name}
                        </button>
                        {plan.paused && <span className="ws-tag">paused</span>}
                        {plan.archived && <span className="ws-tag">archived</span>}
                      </div>
                      {!folded.has(plan.jobId) && (
                        <ul className="ws-groups">
                          {planSessions(plan).length === 0 && <li className="ws-empty">No sessions</li>}
                          {GROUPS.filter(([k]) => plan[k].length > 0).map(([k, title]) => (
                            <li key={k}>
                              <div className="ws-group">{title}</div>
                              <ul>{plan[k].map(sessionRow(plan))}</ul>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
