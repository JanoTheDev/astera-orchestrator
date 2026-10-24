// The Agents side bar view (DESIGN-W13 §4): the open project's consoles in four panes (Needs you, Working, Idle,
// Finished, the last closed until opened), one row each: status dot, title, project › plan, then account, model ·
// effort and time on the right. A click opens the console's own tab; hover actions and the context menu have the rest.
// The consoles come from AgentsPage's snapshot (wall/consoleStore.ts), so this view never polls the Host itself.
import { useEffect, useMemo, useState } from 'react'
import { sessionTab } from '../../../../core/panes/tabId'
import { groupOfTab } from '../../../../core/panes/tree'
import { Button, Chip, EmptyState, ICONS, Icon, IconButton, Menu, Tree, ViewContainer, ViewPane, menuPointOf, type MenuItem, type TreeItem } from '../ui'
import { scopeSessions } from '../../state/projectView'
import { openConsole, openPlan } from '../shell/navigation'
import { consolesOfSessions } from '../shell/shellView'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { useConsoleSnapshot } from '../wall/consoleStore'
import { setAgentsPlan, useAgentsPlan, useAgentsPlanRefs } from './agentsPlan'
import { stopConsole } from '../wall/stopConsole'
import { stateWord } from '../wall/Wall'
import { outcomeText } from '../wall/summaryText'
import { elapsedLabel, modelEffortLabel, rowTimeOf } from '../wall/sessionRow'
import { ALL_PLANS, NO_PLAN, agentPanes, consoleDescription, consoleTitle, plansOf, type TileState, type WallConsole } from '../wall/wallModel'
import '../wall/wall.css'
import './agents.css'

const PANES: { state: TileState; title: 'shell.agents.needs' | 'shell.agents.working' | 'agents.view.idle' | 'shell.agents.finished' }[] = [
  { state: 'needs', title: 'shell.agents.needs' },
  { state: 'working', title: 'shell.agents.working' },
  { state: 'idle', title: 'agents.view.idle' },
  { state: 'finished', title: 'shell.agents.finished' }
]

/** The status dot's colour: a finished console that gave up reads failed. */
type Dot = 'needs' | 'working' | 'idle' | 'finished' | 'failed'

export function AgentsView(p: SideBarViewProps): React.JSX.Element {
  const { t, sessions, workspaceIds, scopeId, accounts, closeWorkbenchTab } = p
  const { consoles, summaries } = useConsoleSnapshot()
  const plan = useAgentsPlan()
  const refs = useAgentsPlanRefs()
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null)
  const setPlan = setAgentsPlan
  // "12m" to the minute
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const scoped = useMemo(() => consolesOfSessions(consoles, scopeSessions(sessions, workspaceIds, scopeId)), [consoles, sessions, workspaceIds, scopeId])
  const plans = useMemo(() => plansOf(scoped), [scoped])
  // a plan that is gone (archived, another project) falls back to every plan; a plan that exists keeps its filter, even with no console yet
  const picked = plan === NO_PLAN || refs.some((x) => x.jobId === plan) || plans.some((x) => x.jobId === plan) ? plan : ALL_PLANS
  const pickedName = refs.find((x) => x.jobId === picked)?.name ?? plans.find((x) => x.jobId === picked)?.name ?? ''
  const shown = scoped.filter((c) => picked === ALL_PLANS || (picked === NO_PLAN ? !c.jobId : c.jobId === picked))
  const planEmpty = picked !== ALL_PLANS && picked !== NO_PLAN && shown.length === 0
  const panes = useMemo(() => agentPanes(shown), [shown])
  const byId = new Map(shown.map((c) => [c.sessionId, c]))

  const accountOf = (c: WallConsole): string | undefined => (c.accountId ? (accounts.find((a) => a.id === c.accountId)?.label ?? c.accountId) : undefined)
  const stop = (c: WallConsole): void => {
    const running = sessions.find((s) => s.id === c.sessionId)?.status !== 'exited'
    void stopConsole(c, running, t, () => closeWorkbenchTab(sessionTab(c.sessionId), 'end'))
  }
  const openSide = (c: WallConsole): void => {
    const tab = sessionTab(c.sessionId)
    const layout = p.layoutRef.current
    if (layout && p.activePaneId && groupOfTab(layout, tab)) p.dropOnPane(p.activePaneId, 'right', tab)
    else openConsole(c.sessionId)
  }
  const rename = (c: WallConsole): void => {
    openConsole(c.sessionId)
    p.setRenamingTabId(sessionTab(c.sessionId))
  }

  const rowOf = (c: WallConsole): TreeItem => {
    const summary = summaries.get(c.sessionId)
    const done = c.state === 'finished'
    const dot: Dot = done && summary?.outcome === 'gave-up' ? 'failed' : c.state
    const word = done && summary ? outcomeText(summary, t) : t(stateWord(c))
    const title = done && summary ? summary.facts.title : consoleTitle(c)
    // scoped to one project, every row is in it: the plan alone says where
    const where = scopeId === null ? consoleDescription(c) : (c.planName ?? '')
    const account = accountOf(c)
    const model = modelEffortLabel(c.model, c.effort)
    // a live console counts from its start, a finished one from its last sign of life (else its start)
    const time = rowTimeOf(c, done)
    return {
      id: c.sessionId,
      depth: 0,
      label: title,
      title: [title, where, account, model].filter(Boolean).join(' — '),
      icon: <span className={`agents-dot agents-dot--${dot}`} role="img" aria-label={word} title={word} />,
      description: where,
      badge: (
        <span className="agents-row__facts">
          {account && <Chip className="agents-row__account">{account}</Chip>}
          {model && <span className="agents-row__model">{model}</span>}
          {time && (
            <time dateTime={new Date(time.at).toISOString()} title={t(time.started ? 'agents.row.started' : 'agents.row.lastActive', { when: new Date(time.at).toLocaleString() })}>
              {elapsedLabel(time.at, nowMs)}
            </time>
          )}
        </span>
      ),
      actions: (
        <>
          <IconButton size="sm" label={t('agents.row.side')} icon={<Icon name="splitView" size={14} />} onClick={() => openSide(c)} />
          {c.jobId && <IconButton size="sm" label={t('agents.row.plan')} icon={<Icon name="listTree" size={14} />} onClick={() => openPlan(c.jobId!)} />}
          {!done && <IconButton size="sm" label={t('agents.row.stop')} icon={<Icon name="stop" size={14} />} onClick={() => stop(c)} />}
        </>
      )
    }
  }

  const menuOf = (c: WallConsole): Array<MenuItem | 'separator'> => [
    { id: 'open', label: t('agents.row.open'), icon: <Icon name="terminal" size={14} />, onSelect: () => openConsole(c.sessionId) },
    { id: 'side', label: t('agents.row.side'), icon: <Icon name="splitView" size={14} />, onSelect: () => openSide(c) },
    ...(c.jobId ? [{ id: 'plan', label: t('agents.row.plan'), icon: <Icon name="listTree" size={14} />, onSelect: () => openPlan(c.jobId!) }] : []),
    { id: 'rename', label: t('agents.row.rename'), icon: <Icon name="edit" size={14} />, onSelect: () => rename(c) },
    ...(c.state === 'finished' ? [] : ['separator' as const, { id: 'stop', label: t('agents.row.stop'), icon: <Icon name="stop" size={14} />, danger: true, onSelect: () => stop(c) }])
  ]

  const filterItems: Array<MenuItem | 'separator'> = [
    { id: ALL_PLANS, label: t('wall.plans.all'), checked: picked === ALL_PLANS, onSelect: () => setPlan(ALL_PLANS) },
    ...plans.map((x) => ({ id: x.jobId, label: x.name, checked: picked === x.jobId, onSelect: () => setPlan(x.jobId) })),
    { id: NO_PLAN, label: t('wall.plans.none'), checked: picked === NO_PLAN, onSelect: () => setPlan(NO_PLAN) }
  ]

  const open = menu ? byId.get(menu.id) : undefined
  const title = t('shell.activity.agents')
  return (
    <ViewContainer label={title}>
      <ViewToolbar
        label={title}
        items={[
          { id: 'new', icon: <Icon name="add" />, label: t('shell.agents.new'), disabled: !p.canStart(), onClick: () => p.setShowNew(true) }
        ]}
      />
      {scoped.length === 0 ? (
        <EmptyState
          icon={ICONS.terminal}
          action={
            <Button variant="primary" disabled={!p.canStart()} onClick={() => p.setShowNew(true)}>
              {t('agents.view.open')}
            </Button>
          }
        >
          {t('agents.view.empty')}
        </EmptyState>
      ) : (
        <>
          {/* only worth a row when there is a plan to pick, or a pick to undo */}
          {(plans.length > 0 || picked !== ALL_PLANS) && (
            <div className="agents-filter">
              <Menu
                label={t('agents.view.filter')}
                align="start"
                items={filterItems}
                trigger={{ variant: 'ghost', size: 'sm', icon: <Icon name="filter" size={14} />, children: picked === ALL_PLANS ? t('wall.plans.all') : picked === NO_PLAN ? t('wall.plans.none') : pickedName }}
              />
            </div>
          )}
          {planEmpty ? (
            <p className="wb-view-empty">{t('agents.view.planEmpty', { name: pickedName })}</p>
          ) : (
            PANES.map(({ state, title: key }) => (
              <ViewPane key={state} title={t(key)} count={panes[state].length} storageKey={`agents.${state}`} defaultExpanded={state !== 'finished'}>
                {panes[state].length === 0 ? (
                  <p className="wb-view-empty">{t('shell.agents.none')}</p>
                ) : (
                  <Tree
                    label={t(key)}
                    className="agents-tree"
                    rows={panes[state].map(rowOf)}
                    selectedId={null}
                    onSelect={openConsole}
                    onOpen={openConsole}
                    onContextMenu={(id, e) => {
                      e.preventDefault()
                      setMenu({ id, at: menuPointOf(e) })
                    }}
                  />
                )}
              </ViewPane>
            ))
          )}
        </>
      )}
      {menu && open && <Menu items={menuOf(open)} at={menu.at} label={consoleTitle(open)} onClose={() => setMenu(null)} />}
    </ViewContainer>
  )
}
