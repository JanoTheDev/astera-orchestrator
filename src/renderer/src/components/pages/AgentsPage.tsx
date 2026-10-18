// W9-H: the Agents page (DESIGN.md §2), the app's default page. Every console of the project at once, each tile the
// session's own xterm; a click opens it full size, where the owner types straight into the PTY while the coordinator's
// messages to it wait in the Host (the owner hold, core/sessions/ownerHold.ts).
//
// The consoles themselves stay in the pane grid (`children`, App's Content), mounted for each session's life: the
// full-size console *is* that pane, and a tile borrows the pane's xterm (wall/consoleDock.ts). So `children` is always
// rendered, in the same place, and only hidden while the wall shows: unmounting it would end every terminal's
// scrollback.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { formatElapsed } from '../../../../core/orchestration/elapsed'
import { parseTab } from '../../../../core/panes/tabId'
import { buildWorkspaceTree } from '../workspace/workspaceTree'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { useAttention } from '../workspace/useAttention'
import { usePlanLive } from '../plan/usePlanLive'
import { localDoor } from '../../lib/orchDoor'
import { openConsole, openPlan } from '../shell/navigation'
import { setWallView, useWallView } from '../wall/wallView'
import { focusTerminal } from '../wall/consoleDock'
import { useJobRows } from '../wall/useJobRows'
import {
  ALL_PLANS, NO_PLAN, consolesOf, detailLineOf, detailsOf, filterConsoles, gridColumns, orderWall, planPills,
  type PlanFilter, type Scope, type StateFilter, type WallConsole
} from '../wall/wallModel'
import { ConsoleStrip, ConsoleTile, PlanPills, WallEmpty, WallToolbar } from '../wall/Wall'
import { ConsoleHeader, DetailsPanel } from '../wall/FullConsole'
import { FinishedCard } from '../wall/FinishedCard'
import type { AppState } from '../../state/appState'
import '../wall/wall.css'

export type AgentsPageProps = Pick<AppState, 'sessions' | 'accounts' | 'currentProject' | 'homeDir' | 'activeTabId'> & {
  children: React.ReactNode
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

export function AgentsPage({ sessions, accounts, currentProject, homeDir, activeTabId, children }: AgentsPageProps): React.JSX.Element {
  const { t } = useI18n()
  const view = useWallView()
  const showing = view.kind !== 'away'
  const anchor = currentProject ?? sessions[0]?.cwd ?? homeDir ?? null
  const data = useWorkspaceData(anchor, showing)
  const tree = useMemo(() => (data ? buildWorkspaceTree(data, { showArchived: false }) : []), [data])
  const rows = useJobRows(anchor, useMemo(() => tree.map((p) => p.id), [tree]), showing)
  const attention = useAttention(useMemo(() => sessions.map((s) => s.id), [sessions]))
  const door = useMemo(() => localDoor(window.api, anchor ?? ''), [anchor])
  const live = usePlanLive(door, showing && anchor !== null)

  const [plan, setPlanState] = useState<PlanFilter>(readPlan)
  const setPlan = (p: PlanFilter): void => {
    setPlanState(p)
    try {
      localStorage.setItem(PLAN_KEY, p)
    } catch {
      // a window without storage keeps the filter in memory only
    }
  }
  const [scope, setScope] = useState<Scope>('project')
  const [filter, setFilter] = useState<StateFilter>('all')
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!showing) return
    const timer = setInterval(() => setNowMs(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [showing])

  const consoles = useMemo(
    () => consolesOf({ sessions, tree, data, attention, live: live.sessions, rows }),
    [sessions, tree, data, attention, live.sessions, rows]
  )
  const projectId = currentProject ? (tree.find((p) => p.path === currentProject)?.id ?? null) : null
  const projectName = tree.find((p) => p.id === projectId)?.name ?? null
  // A plan that is gone (archived, another project) falls back to every plan.
  const pills = planPills(tree, rows, consoles, projectId, scope)
  const planShown = plan === ALL_PLANS || plan === NO_PLAN || tree.some((p) => p.plans.some((x) => x.jobId === plan)) ? plan : ALL_PLANS
  const shown = filterConsoles(consoles, { plan: planShown, state: filter, scope, projectId })
  const wall = orderWall(shown, planShown)

  // Escalations per plan (open ones in the Inbox) and the coordinator's answers (the activity feed), for the details.
  const runOfJob = (jobId: string): string => tree.flatMap((p) => p.plans).find((x) => x.jobId === jobId)?.runId ?? jobId
  const answeredOf = (jobId: string): number =>
    live.activity.filter((e) => (e.type as string) === 'question.auto-answered' && (e.jobId === jobId || e.runId === runOfJob(jobId))).length
  const escalatedOf = (jobId: string): number => (data?.escalations ?? []).filter((m) => m.runId === runOfJob(jobId)).length
  const detailsFor = (c: WallConsole) =>
    detailsOf({ console: c, consoles, rows, tree, tasks: data?.tasks ?? [], answeredOf, escalatedOf })
  const lineOf = (c: WallConsole): string | null => {
    const l = detailLineOf(detailsFor(c), nowMs, formatElapsed)
    return l ? t(l.key, l.params) : null
  }

  // Any other way to a tab (the sidebar tree, a notice, a file opened from the explorer) leaves the wall for it: a
  // session tab opens that console full size, anything else gives the window to that page. The first tab (the saved
  // layout restored at start) is not such a move: the app opens on the wall.
  const lastTab = useRef(activeTabId)
  useEffect(() => {
    if (lastTab.current === activeTabId) return
    const first = lastTab.current === null
    lastTab.current = activeTabId
    if (first) return
    const ref = activeTabId ? parseTab(activeTabId) : null
    if (ref?.kind === 'session') setWallView({ kind: 'console', sessionId: ref.id })
    else if (activeTabId) setWallView({ kind: 'away' })
  }, [activeTabId])

  // The owner hold (DESIGN §2): a console open full size holds the coordinator's messages to it in the Host until
  // "Back to all". Typing holds it too, for 60 s, which the Host stamps on its own.
  const heldId = view.kind === 'console' ? view.sessionId : null
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

  // The keyboard follows the view: the full-size console takes it (keys go to that PTY only), and the wall takes it
  // away from the hidden pane grid, so nothing typed on the wall reaches a console behind it.
  const consoleRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (heldId) {
      const frame = requestAnimationFrame(() => focusTerminal(heldId))
      return () => cancelAnimationFrame(frame)
    }
    const el = document.activeElement
    if (view.kind === 'wall' && el instanceof HTMLElement && consoleRef.current?.contains(el)) el.blur()
    return undefined
  }, [heldId, view.kind])

  // Ctrl+. folds the details panel of the open console.
  useEffect(() => {
    if (view.kind !== 'console') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key === '.') {
        e.preventDefault()
        setDetailsOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [view.kind])

  const back = (): void => setWallView({ kind: 'wall' })
  const open = (sessionId: string): void => openConsole(sessionId)
  const strip = (
    <ConsoleStrip
      consoles={filterConsoles(consoles, { plan: planShown, state: 'all', scope, projectId })}
      mainId={wall.mainId}
      selected={heldId}
      onAll={back}
      onOpen={open}
    />
  )
  const opened = heldId ? consoles.find((c) => c.sessionId === heldId) : undefined
  const grid = [...wall.pinned, ...(filter === 'finished' ? wall.finished : wall.tiles)]
  const exitOf = (id: string): number | undefined => sessions.find((s) => s.id === id)?.exitCode

  return (
    <div className="agents-page">
      {/* Also while another page has the window: until W9-B's top bar lands, "All consoles" here is the way back. */}
      {strip}
      {view.kind === 'wall' && (
        <div className="wall">
          <PlanPills pills={pills} value={planShown} onChange={setPlan} />
          <WallToolbar
            scope={scope}
            onScope={setScope}
            projectName={projectName}
            planPicked={planShown !== ALL_PLANS && planShown !== NO_PLAN}
            filter={filter}
            onFilter={setFilter}
          />
          {grid.length === 0 ? (
            <WallEmpty />
          ) : (
            <div className="wall-grid" style={{ '--wall-cols': gridColumns(grid.length) } as React.CSSProperties}>
              {grid.map((c) => (
                <ConsoleTile key={c.sessionId} c={c} main={c.sessionId === wall.mainId} detail={lineOf(c)} onOpen={() => open(c.sessionId)} />
              ))}
            </div>
          )}
          {filter !== 'finished' && wall.finished.length > 0 && (
            <section className="wall-finished">
              <h2 className="wall-finished__title">{t('wall.finished.title')}</h2>
              <div className="wall-finished__row">
                {wall.finished.map((c) => (
                  <FinishedCard key={c.sessionId} c={c} exitCode={exitOf(c.sessionId)} onOpen={() => open(c.sessionId)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {view.kind === 'console' && opened && (
        <ConsoleHeader c={opened} projectName={projectName} detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen((o) => !o)} onBack={back} />
      )}
      <div className="agents-page__body" style={view.kind === 'wall' ? { display: 'none' } : undefined}>
        <div className="agents-page__console" ref={consoleRef}>
          {children}
        </div>
        {view.kind === 'console' && opened && detailsOpen && (
          <DetailsPanel d={detailsFor(opened)} accounts={accounts} nowMs={nowMs} onOpenConsole={open} onOpenPlan={(jobId) => openPlan(jobId, 'waves')} />
        )}
      </div>
    </div>
  )
}
