// W9-H, W11, W13: the wall tab's host (DESIGN-W13 §5) and the app's one owner of the console data. The wall is drawn over
// the pane grid while `view:wall` is the active tab; a console is its own tab (PaneGrid), never a mode of the wall.
// It publishes the consoles for the Agents view and the console headers (wall/consoleStore.ts).
//
// The consoles themselves stay in the pane grid (`children`, App's Content), mounted for each session's life: a wall
// card borrows the pane's xterm (wall/consoleDock.ts). So `children` is always rendered, in the same place, and only
// hidden while the wall shows: unmounting it would end every terminal's scrollback.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { parseTab, sessionTab } from '../../../../core/panes/tabId'
import { buildWorkspaceTree } from '../../state/workspaceTree'
import { useWorkspaceData } from '../../state/useWorkspaceData'
import { useAttention } from '../../state/useAttention'
import { usePlanLive } from '../plan/usePlanLive'
import { ageOf } from '../plan/planBoard'
import { localDoor } from '../../lib/orchDoor'
import { openConsole, openPlan } from '../shell/navigation'
import { setWallView, useWallView } from '../wall/wallView'
import { useJobRows } from '../wall/useJobRows'
import {
  ALL_PLANS, NO_PLAN, activityOf, consoleDescription, consolesOf, filterConsoles, gridColumns, groupWall, orderWall, planPills, sectionWall,
  type PlanFilter, type StateFilter, type TileState, type WallConsole
} from '../wall/wallModel'
import { ConsoleTile, PlanGroup, SectionHead, WallEmpty, WallFilters } from '../wall/Wall'
import { stopConsole } from '../wall/stopConsole'
import { setConsoleSnapshot } from '../wall/consoleStore'
import { Button, Icon } from '../ui'
import { FinishedCard } from '../wall/FinishedCard'
import { SummaryCard } from '../wall/SummaryCard' // W9-I
import { useSummaries } from '../../state/useSummaries'
import { scopeTree, UNKNOWN_PROJECT } from '../../state/projectView'
import type { AppState } from '../../state/appState'
import { setAgentSessions } from '../../lib/recentlyClosed'
import '../wall/wall.css'

export type AgentsPageProps = Pick<AppState, 'sessions' | 'accounts' | 'currentProject' | 'homeDir' | 'activeTabId' | 'scopeId' | 'allProjects' | 'setAllProjects' | 'closeWorkbenchTab'> & {
  /** W11: the header's and the empty state's "New console" (the New dialog's Console choice). */
  setShowNew?: AppState['setShowNew']
  children: React.ReactNode
  /** W9-B: when the wall tab is not shown the whole page is hidden, its pane grid with it. */
  hidden?: boolean
}

/** Per window (DESIGN §2: "The filter is remembered per window"): localStorage is the window's, and a failed read is the default. */
const PLAN_KEY = 'cm.agents.planFilter'
const readPlan = (): PlanFilter => {
  try {
    return localStorage.getItem(PLAN_KEY) ?? ALL_PLANS
  } catch {
    return ALL_PLANS
  }
}

export function AgentsPage({ sessions, accounts, currentProject, scopeId, allProjects, setAllProjects, homeDir, activeTabId, closeWorkbenchTab, setShowNew, children, hidden }: AgentsPageProps): React.JSX.Element {
  const { t } = useI18n()
  const view = useWallView()
  const anchor = currentProject ?? sessions[0]?.cwd ?? homeDir ?? null
  const data = useWorkspaceData(anchor, true)
  const tree = useMemo(() => (data ? buildWorkspaceTree(data, { showArchived: false }) : []), [data])
  const rows = useJobRows(anchor, useMemo(() => tree.map((p) => p.id), [tree]), true)
  const attention = useAttention(useMemo(() => sessions.map((s) => s.id), [sessions]))
  const door = useMemo(() => localDoor(window.api, anchor ?? ''), [anchor])
  const live = usePlanLive(door, anchor !== null)
  const summaries = useSummaries(anchor !== null ? door : null) // W9-I: the Finished row's cards

  const [plan, setPlanState] = useState<PlanFilter>(readPlan)
  const setPlan = (p: PlanFilter): void => {
    setPlanState(p)
    try {
      localStorage.setItem(PLAN_KEY, p)
    } catch {
      // a window without storage keeps the filter in memory only
    }
  }
  // openPlanConsoles(plan): a plan page's "Its consoles" asks for that plan, by Job or Run id (the pills are by Job)
  const asked = view.kind === 'wall' ? view.plan : undefined
  useEffect(() => {
    if (asked !== undefined) setPlan(tree.flatMap((p) => p.plans).find((x) => x.jobId === asked || x.runId === asked)?.jobId ?? asked)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request (each one is a new view)
  }, [view])
  const [filter, setFilter] = useState<StateFilter>('all')
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (view.kind !== 'wall') return
    const timer = setInterval(() => setNowMs(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [view.kind])

  const consoles = useMemo(
    () => consolesOf({ sessions, tree, data, attention, live: live.sessions, rows }),
    [sessions, tree, data, attention, live.sessions, rows]
  )
  // T13: an agent's tab hides on close without asking (lib/recentlyClosed.ts); the tree says which sessions those are
  useEffect(() => setAgentSessions(consoles.filter((c) => c.role !== 'console').map((c) => c.sessionId)), [consoles])
  useEffect(() => setConsoleSnapshot({ consoles, summaries: summaries.bySession }), [consoles, summaries.bySession])
  // the window's own project (App's scopeId: switcher or bound project, else the tab's folder resolved to its project)
  const projectId = scopeId === null || scopeId === UNKNOWN_PROJECT ? null : scopeId
  // A plan that is gone (archived, another project) falls back to every plan.
  const planShown = plan === ALL_PLANS || plan === NO_PLAN || scopeTree(tree, allProjects ? null : projectId ?? UNKNOWN_PROJECT).some((p) => p.plans.some((x) => x.jobId === plan)) ? plan : ALL_PLANS
  const planPicked = planShown !== ALL_PLANS && planShown !== NO_PLAN
  // W11: one "All projects" chip; off, a picked plan shows all of its consoles (scope `plan`), else the open project's.
  const scope = allProjects ? 'all' : planPicked ? 'plan' : 'project'
  const pills = planPills(tree, rows, consoles, projectId, allProjects ? 'all' : 'project')
  const inScope = filterConsoles(consoles, { plan: planShown, state: 'all', scope, projectId })
  const counts: Record<TileState, number> = { needs: 0, working: 0, idle: 0, finished: 0 }
  for (const c of inScope) counts[c.state]++
  const shown = filterConsoles(consoles, { plan: planShown, state: filter, scope, projectId })
  const wall = orderWall(shown, planShown)

  const accountOf = (id: string | undefined): string | undefined => (id ? (accounts.find((a) => a.id === id)?.label ?? id) : undefined)
  /** The card's description line: the same "plan › task · account" as the Agents view's row, then the last activity. */
  const metaOf = (c: WallConsole): string[] => {
    const at = live.sessions[c.sessionId]?.lastAction?.at
    return [
      consoleDescription(c, accountOf(c.accountId)),
      at !== undefined ? t('wall.tile.ago', { age: ageOf(new Date(at).toISOString(), nowMs) }) : undefined
    ].filter((x): x is string => !!x)
  }

  // Any tab but the wall's leaves the wall for it, and so does closing the last tab: the wall's own tab is the only
  // way back (EditorArea turns it on again for `view:wall`), so a wall left on with no tab would cover the next tab
  // opened. The app opens away from the wall (EditorArea), so the first tab needs no exemption.
  const lastTab = useRef(activeTabId)
  useEffect(() => {
    if (lastTab.current === activeTabId) return
    lastTab.current = activeTabId
    setWallView({ kind: 'away' })
  }, [activeTabId])

  // The owner hold (DESIGN §2): a console tab in view holds the coordinator's messages to it in the Host until the
  // owner leaves it. Typing holds it too, for 60 s, which the Host stamps on its own.
  const activeRef = activeTabId ? parseTab(activeTabId) : null
  const heldId = view.kind === 'away' && activeRef?.kind === 'session' ? activeRef.id : null
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

  // The wall takes the keyboard away from the hidden pane grid, so nothing typed on the wall reaches a console behind it.
  const consoleRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = document.activeElement
    if (view.kind === 'wall' && el instanceof HTMLElement && consoleRef.current?.contains(el)) el.blur()
  }, [view.kind])

  const open = (sessionId: string): void => openConsole(sessionId)
  const exitOf = (id: string): number | undefined => sessions.find((s) => s.id === id)?.exitCode
  const newConsole = setShowNew ? () => setShowNew(true) : undefined

  // W11: the wall grouped by plan (tree order; consoles of no plan last), each group its live tiles (coordinator
  // pinned first) then its finished consoles as summary cards. The Done filter leaves only the cards.
  const liveTiles = filter === 'finished' ? [] : [...wall.pinned, ...wall.tiles]
  const groups = groupWall(liveTiles, wall.finished)
  const sections = sectionWall(liveTiles, wall.finished)
  // As many columns as the biggest group fills, up to the auto grid's count; CSS drops to fewer under 360px a tile.
  const cols = Math.min(gridColumns(liveTiles.length), Math.max(1, ...groups.map((g) => g.live.length)))
  const endSession = (c: WallConsole): void =>
    void stopConsole(c, sessions.find((s) => s.id === c.sessionId)?.status !== 'exited', t, () => closeWorkbenchTab(sessionTab(c.sessionId), 'end'))
  const tile = (c: WallConsole): React.JSX.Element => {
    const a = activityOf(c, live.sessions[c.sessionId]?.lastAction)
    return (
      <ConsoleTile
        key={c.sessionId}
        c={c}
        main={c.sessionId === wall.mainId}
        meta={metaOf(c)}
        activity={t(a.key, a.params)}
        onOpen={() => open(c.sessionId)}
        onHide={() => closeWorkbenchTab(sessionTab(c.sessionId), 'hide')}
        onEnd={() => endSession(c)}
      />
    )
  }
  const card = (c: WallConsole): React.JSX.Element => {
    const s = summaries.bySession.get(c.sessionId)
    return s ? (
      <SummaryCard key={c.sessionId} summary={s} compact onOpen={() => open(c.sessionId)} />
    ) : (
      <FinishedCard key={c.sessionId} c={c} exitCode={exitOf(c.sessionId)} meta={metaOf(c)} onOpen={() => open(c.sessionId)} />
    )
  }
  const resetFilters = (): void => {
    setFilter('all')
    setPlan(ALL_PLANS)
    setAllProjects(true)
  }

  return (
    <div className="agents-page" style={hidden ? { display: 'none' } : undefined}>
      {view.kind === 'wall' && (
        <div className="wall">
          {consoles.length > 0 && (
            <div className="wall-toolbar">
              <WallFilters
                filter={filter}
                onFilter={setFilter}
                counts={counts}
                pills={pills}
                plan={planShown}
                onPlan={setPlan}
                allProjects={allProjects}
                onAllProjects={setAllProjects}
              />
              {newConsole && (
                <Button size="sm" variant="ghost" icon={<Icon name="add" size={14} />} onClick={newConsole}>
                  {t('wall.new')}
                </Button>
              )}
            </div>
          )}
          {groups.length === 0 ? (
            <WallEmpty filtered={consoles.length > 0} onNew={newConsole} onReset={resetFilters} />
          ) : (
            <div className="wall-body" style={{ '--wall-cols': cols } as React.CSSProperties}>
              {sections.map((sec) => {
                const secGroups = groupWall(sec.live, sec.done)
                return (
                  <div key={sec.role} className="wall-section">
                    <SectionHead role={sec.role} count={sec.count} />
                    {secGroups.map((g) => {
                      const pill = pills.find((p) => p.jobId === g.key)
                      const first = g.live[0] ?? g.done[0]
                      return (
                        <PlanGroup
                          key={g.key}
                          pill={pill}
                          name={g.key !== NO_PLAN ? (first?.planName ?? g.key) : secGroups.length > 1 ? t('wall.plans.none') : null}
                          live={g.live.map(tile)}
                          done={g.done.map(card)}
                          {...(g.key !== NO_PLAN ? { onOpenPlan: () => openPlan(g.key, 'waves') } : {})}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      <div className="agents-page__body">
        <div className="agents-page__console" ref={consoleRef}>
          {children}
        </div>
      </div>
    </div>
  )
}
