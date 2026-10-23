// The Agents side bar view (DESIGN-W13 §4): the open project's consoles in four panes (Needs you, Working, Idle,
// Finished), one row each. A click opens the console's own tab; the context menu has the rest. The consoles come from
// AgentsPage's snapshot (wall/consoleStore.ts), so this view never polls the Host itself.
import { useMemo, useState } from 'react'
import { sessionTab } from '../../../../core/panes/tabId'
import { groupOfTab } from '../../../../core/panes/tree'
import { Button, Icon, IconButton, Menu, Tree, ViewContainer, ViewPane, menuPointOf, type MenuItem, type TreeItem } from '../ui'
import { scopeSessions } from '../../state/projectView'
import { openConsole, openPlan, openView } from '../shell/navigation'
import { consolesOfSessions } from '../shell/shellView'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { useConsoleSnapshot } from '../wall/consoleStore'
import { stopConsole } from '../wall/stopConsole'
import { stateGlyph, stateTone, stateWord } from '../wall/Wall'
import { outcomeText, outcomeTone } from '../wall/summaryText'
import { ALL_PLANS, NO_PLAN, agentPanes, consoleDescription, consoleTitle, plansOf, type TileState, type WallConsole } from '../wall/wallModel'
import '../wall/wall.css'

const PLAN_KEY = 'cm.agentsView.plan'
const readPlan = (): string => {
  try {
    return localStorage.getItem(PLAN_KEY) ?? ALL_PLANS
  } catch {
    return ALL_PLANS
  }
}

const PANES: { state: TileState; title: 'shell.agents.needs' | 'shell.agents.working' | 'agents.view.idle' | 'shell.agents.finished' }[] = [
  { state: 'needs', title: 'shell.agents.needs' },
  { state: 'working', title: 'shell.agents.working' },
  { state: 'idle', title: 'agents.view.idle' },
  { state: 'finished', title: 'shell.agents.finished' }
]

export function AgentsView(p: SideBarViewProps): React.JSX.Element {
  const { t, sessions, workspaceIds, scopeId, accounts, closeWorkbenchTab } = p
  const { consoles, summaries } = useConsoleSnapshot()
  const [plan, setPlanState] = useState(readPlan)
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null)
  const setPlan = (next: string): void => {
    setPlanState(next)
    try {
      localStorage.setItem(PLAN_KEY, next)
    } catch {
      // a window without storage keeps the filter in memory only
    }
  }

  const scoped = useMemo(() => consolesOfSessions(consoles, scopeSessions(sessions, workspaceIds, scopeId)), [consoles, sessions, workspaceIds, scopeId])
  const plans = useMemo(() => plansOf(scoped), [scoped])
  // a plan that is gone (archived, another project) falls back to every plan
  const picked = plan === NO_PLAN || plans.some((x) => x.jobId === plan) ? plan : ALL_PLANS
  const shown = scoped.filter((c) => picked === ALL_PLANS || (picked === NO_PLAN ? !c.jobId : c.jobId === picked))
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
    return {
      id: c.sessionId,
      depth: 0,
      label: done && summary ? summary.facts.title : consoleTitle(c),
      icon: <Icon name={stateGlyph(c)} size={16} />,
      description: consoleDescription(c, accountOf(c)),
      decoration: done && summary ? { text: outcomeText(summary, t), tone: outcomeTone(summary.outcome) } : { text: t(stateWord(c)), tone: stateTone(c) },
      ...(done
        ? {}
        : { actions: <IconButton size="sm" label={t('agents.row.stop')} icon={<Icon name="stop" size={14} />} onClick={() => stop(c)} /> })
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
          { id: 'new', icon: <Icon name="add" />, label: t('shell.agents.new'), disabled: !p.canStart(), onClick: () => p.setShowNew(true) },
          { id: 'wall', icon: <Icon name="layoutGrid" />, label: t('shell.agents.wall'), onClick: () => openView('wall') }
        ]}
      />
      {scoped.length === 0 ? (
        <div className="agents-welcome">
          <p>{t('agents.view.empty')}</p>
          <Button variant="primary" disabled={!p.canStart()} onClick={() => p.setShowNew(true)}>
            {t('agents.view.open')}
          </Button>
        </div>
      ) : (
        <>
          <div className="agents-filter">
            <Menu
              label={t('agents.view.filter')}
              align="start"
              items={filterItems}
              trigger={{ variant: 'ghost', size: 'sm', icon: <Icon name="filter" size={14} />, children: picked === ALL_PLANS ? t('wall.plans.all') : picked === NO_PLAN ? t('wall.plans.none') : (plans.find((x) => x.jobId === picked)?.name ?? '') }}
            />
          </div>
          {PANES.map(({ state, title: key }) => (
            <ViewPane key={state} title={t(key)} count={panes[state].length} storageKey={`agents.${state}`}>
              {panes[state].length === 0 ? (
                <p className="wb-view-empty">{t('shell.agents.none')}</p>
              ) : (
                <Tree
                  label={t(key)}
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
          ))}
        </>
      )}
      {menu && open && <Menu items={menuOf(open)} at={menu.at} label={consoleTitle(open)} onClose={() => setMenu(null)} />}
    </ViewContainer>
  )
}
