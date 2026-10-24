// W9-H, W11, W13: the app's one owner of the console data. It publishes the consoles for the Agents view and the console
// headers (wall/consoleStore.ts) and holds the coordinator's messages while a console tab is in view. A console is its
// own tab (PaneGrid); the pane grid (`children`, App's Content) is mounted for the window's life, so no terminal's
// scrollback ends.
import { useEffect, useMemo } from 'react'
import { parseTab } from '../../../../core/panes/tabId'
import { buildWorkspaceTree } from '../../state/workspaceTree'
import { useAttention } from '../../state/useAttention'
import { usePlanLive } from '../plan/usePlanLive'
import { localDoor } from '../../lib/orchDoor'
import { useJobRows } from '../wall/useJobRows'
import { consolesOf } from '../wall/wallModel'
import { setConsoleSnapshot } from '../wall/consoleStore'
import { setAgentsPlanRefs } from '../views/agentsPlan'
import { useSummaries } from '../../state/useSummaries'
import type { AppState } from '../../state/appState'
import { setAgentSessions } from '../../lib/recentlyClosed'
import '../wall/wall.css'

export type AgentsPageProps = Pick<AppState, 'sessions' | 'currentProject' | 'homeDir' | 'activeTabId' | 'workspaceData'> & {
  children: React.ReactNode
  /** W9-B: when the page is not shown the whole page is hidden, its pane grid with it. */
  hidden?: boolean
}

export function AgentsPage({ sessions, currentProject, homeDir, activeTabId, workspaceData: data, children, hidden }: AgentsPageProps): React.JSX.Element {
  const anchor = currentProject ?? sessions[0]?.cwd ?? homeDir ?? null
  // the window's one workspace poll (useWorkspace), not a second one; the polls below ask only while the page is shown
  const shown = !hidden
  const tree = useMemo(() => (data ? buildWorkspaceTree(data, { showArchived: false }) : []), [data])
  const rows = useJobRows(anchor, useMemo(() => tree.map((p) => p.id), [tree]), shown)
  const attention = useAttention(useMemo(() => sessions.map((s) => s.id), [sessions]))
  const door = useMemo(() => localDoor(window.api, anchor ?? ''), [anchor])
  const live = usePlanLive(door, anchor !== null && shown)
  const summaries = useSummaries(anchor !== null && shown ? door : null) // W9-I: the Finished row's cards

  const consoles = useMemo(
    () => consolesOf({ sessions, tree, data, attention, live: live.sessions, rows }),
    [sessions, tree, data, attention, live.sessions, rows]
  )
  // T13: an agent's tab hides on close without asking (lib/recentlyClosed.ts); the tree says which sessions those are
  useEffect(() => setAgentSessions(consoles.filter((c) => c.role !== 'console').map((c) => c.sessionId)), [consoles])
  useEffect(() => setConsoleSnapshot({ consoles, summaries: summaries.bySession }), [consoles, summaries.bySession])
  // the plans a plan filter id resolves against (a Run id to its Job), for the Agents side bar
  useEffect(() => setAgentsPlanRefs(tree.flatMap((p) => p.plans).map((x) => ({ jobId: x.jobId, name: x.name, ...(x.runId ? { runId: x.runId } : {}) }))), [tree])

  // The owner hold (DESIGN §2): a console tab in view holds the coordinator's messages to it in the Host until the
  // owner leaves it. Typing holds it too, for 60 s, which the Host stamps on its own.
  const activeRef = activeTabId ? parseTab(activeTabId) : null
  const heldId = activeRef?.kind === 'session' ? activeRef.id : null
  const heldCwd = heldId ? sessions.find((s) => s.id === heldId)?.cwd : undefined
  useEffect(() => {
    const path = heldCwd ?? anchor
    if (!heldId || !path) return
    const hold = (viewing: boolean): void =>
      void window.api.orch.command(path, 'owner-hold', { sessionId: heldId, viewing }).catch(() => {})
    hold(true)
    return () => hold(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hold follows the open console, not the anchor
  }, [heldId])

  return (
    <div className="agents-page" style={hidden ? { display: 'none' } : undefined}>
      <div className="agents-page__body">
        <div className="agents-page__console">{children}</div>
      </div>
    </div>
  )
}
