// W9-H, W11: the Agents page (DESIGN.md §2, DESIGN-W11 §9), the app's default page. Every console of the project at once, each tile the
// session's own xterm; a click opens it full size, where the owner types straight into the PTY while the coordinator's
// messages to it wait in the Host (the owner hold, core/sessions/ownerHold.ts).
//
// The consoles themselves stay in the pane grid (`children`, App's Content), mounted for each session's life: the
// full-size console *is* that pane, and a tile borrows the pane's xterm (wall/consoleDock.ts). So `children` is always
// rendered, in the same place, and only hidden while the wall shows: unmounting it would end every terminal's
// scrollback.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { formatElapsed } from '../../../../core/orchestration/elapsed'
import { parseTab } from '../../../../core/panes/tabId'
import { buildWorkspaceTree } from '../../state/workspaceTree'
import { useWorkspaceData } from '../../state/useWorkspaceData'
import { useAttention } from '../../state/useAttention'
import { usePlanLive } from '../plan/usePlanLive'
import { localDoor } from '../../lib/orchDoor'
import { openConsole, openPlan } from '../shell/navigation'
import { setWallView, useWallView } from '../wall/wallView'
import { focusTerminal } from '../wall/consoleDock'
import { useJobRows } from '../wall/useJobRows'
import {
  ALL_PLANS, NO_PLAN, consolesOf, detailLineOf, detailsOf, filterConsoles, gridColumns, groupWall, orderWall, planPills, sectionWall,
  type PlanFilter, type StateFilter, type TileState, type WallConsole
} from '../wall/wallModel'
import { ConsoleStrip, ConsoleTile, PlanGroup, SectionHead, WallEmpty, WallFilters } from '../wall/Wall'
import { Button, PageHeader, cx } from '../ui'
import { ConsoleHeader, DetailsPanel } from '../wall/FullConsole'
import { FinishedCard } from '../wall/FinishedCard'
import { SummaryCard } from '../wall/SummaryCard' // W9-I
import { useSummaries } from '../../state/useSummaries'
import { scopeTree, UNKNOWN_PROJECT } from '../../state/projectView'
import type { AppState } from '../../state/appState'
import '../wall/wall.css'

export type AgentsPageProps = Pick<AppState, 'sessions' | 'accounts' | 'currentProject' | 'homeDir' | 'activeTabId' | 'scopeId' | 'allProjects' | 'setAllProjects'> & {
  /** W11: the header's and the empty state's "New console" (the New dialog's Console choice). */
  setShowNew?: AppState['setShowNew']
  children: React.ReactNode
  /** W9-B: off the console pages (Pages.tsx `showsConsoles`) the whole page is hidden, its pane grid with it. */
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

export function AgentsPage({ sessions, accounts, currentProject, scopeId, allProjects, setAllProjects, homeDir, activeTabId, setShowNew, children, hidden }: AgentsPageProps): React.JSX.Element {
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
  const summaries = useSummaries(showing && anchor !== null ? door : null) // W9-I: the Finished row's cards

  const [plan, setPlanState] = useState<PlanFilter>(readPlan)
  const setPlan = (p: PlanFilter): void => {
    setPlanState(p)
    try {
      localStorage.setItem(PLAN_KEY, p)
    } catch {
      // a window without storage keeps the filter in memory only
    }
  }
  // openPage('agents', plan): a plan page's "Its consoles" asks for that plan, by Job or Run id (the pills are by Job)
  const asked = view.kind === 'wall' ? view.plan : undefined
  useEffect(() => {
    if (asked !== undefined) setPlan(tree.flatMap((p) => p.plans).find((x) => x.jobId === asked || x.runId === asked)?.jobId ?? asked)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request (each one is a new view)
  }, [view])
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
  // the window's own project (App's scopeId: switcher or bound project, else the tab's folder resolved to its project)
  const projectId = scopeId === null || scopeId === UNKNOWN_PROJECT ? null : scopeId
  // a project made a moment ago has no tab yet, so the tree lacks it: name it by its folder
  const projectName = tree.find((p) => p.id === projectId)?.name ?? currentProject?.split(/[\\/]/).filter(Boolean).pop() ?? null
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

  // Escalations per plan (open ones in the Inbox) and the coordinator's answers (the activity feed), for the details.
  const runOfJob = (jobId: string): string => tree.flatMap((p) => p.plans).find((x) => x.jobId === jobId)?.runId ?? jobId
  const answeredOf = (jobId: string): number =>
    live.activity.filter((e) => (e.type as string) === 'question.auto-answered' && (e.jobId === jobId || e.runId === runOfJob(jobId))).length
  const escalatedOf = (jobId: string): number => (data?.escalations ?? []).filter((m) => m.runId === runOfJob(jobId)).length
  const detailsFor = (c: WallConsole) =>
    detailsOf({ console: c, consoles, rows, tree, tasks: data?.tasks ?? [], answeredOf, escalatedOf })
  const accountOf = (id: string | undefined): string | undefined => (id ? (accounts.find((a) => a.id === id)?.label ?? id) : undefined)
  /** The tile's meta line: plan (when the wall mixes plans), account, the role's detail (time running, files). */
  const metaOf = (c: WallConsole): string[] => {
    const l = detailLineOf(detailsFor(c), nowMs, formatElapsed)
    return [planPicked ? undefined : c.planName, accountOf(c.accountId), l ? t(l.key, l.params) : undefined].filter((x): x is string => !!x)
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
  const opened = heldId ? consoles.find((c) => c.sessionId === heldId) : undefined
  const exitOf = (id: string): number | undefined => sessions.find((s) => s.id === id)?.exitCode
  const newConsole = setShowNew ? () => setShowNew(true) : undefined

  // W11: the wall grouped by plan (tree order; consoles of no plan last), each group its live tiles (coordinator
  // pinned first) then its finished consoles as summary cards. The Done filter leaves only the cards.
  const liveTiles = filter === 'finished' ? [] : [...wall.pinned, ...wall.tiles]
  const groups = groupWall(liveTiles, wall.finished)
  const sections = sectionWall(liveTiles, wall.finished)
  // As many columns as the biggest group fills, up to the auto grid's count; CSS drops to fewer under 360px a tile.
  const cols = Math.min(gridColumns(liveTiles.length), Math.max(1, ...groups.map((g) => g.live.length)))
  const tile = (c: WallConsole): React.JSX.Element => (
    <ConsoleTile key={c.sessionId} c={c} main={c.sessionId === wall.mainId} meta={metaOf(c)} onOpen={() => open(c.sessionId)} />
  )
  const card = (c: WallConsole): React.JSX.Element => {
    const s = summaries.bySession.get(c.sessionId)
    return s ? (
      <SummaryCard key={c.sessionId} summary={s} compact onOpen={() => open(c.sessionId)} />
    ) : (
      <FinishedCard key={c.sessionId} c={c} exitCode={exitOf(c.sessionId)} account={accountOf(c.accountId)} onOpen={() => open(c.sessionId)} />
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
          <PageHeader
            className="wall-header"
            title={t('wall.title')}
            subtitle={inScope.length > 0 ? t('wall.count', { n: inScope.length }) : undefined}
            actions={
              newConsole &&
              consoles.length > 0 && (
                <Button variant="primary" icon={<Plus size={16} />} onClick={newConsole}>
                  {t('wall.new')}
                </Button>
              )
            }
            filters={
              consoles.length > 0 && (
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
              )
            }
          />
          {groups.length === 0 ? (
            <WallEmpty filtered={consoles.length > 0} onNew={newConsole} onReset={resetFilters} />
          ) : (
            <div className={cx('wall-body', cols === 1 && 'wall-body--one')} style={{ '--wall-cols': cols } as React.CSSProperties}>
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
      {view.kind === 'console' && opened && (
        <ConsoleHeader c={opened} projectName={projectName} detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen((o) => !o)} onBack={back} />
      )}
      {view.kind !== 'wall' && (
        <ConsoleStrip consoles={inScope} mainId={wall.mainId} selected={heldId} onAll={back} onOpen={open} />
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
