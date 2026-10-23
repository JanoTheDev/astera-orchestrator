// The Agents side bar view (DESIGN-W13 §4). Adapter until its own Task: the open project's consoles in three panes
// (Needs you, Working, Finished), a row opening the console's tab; the toolbar opens a console or the wall.
import { useMemo } from 'react'
import { Icon, Tree, ViewContainer, ViewPane, type TreeItem } from '../ui'
import { scopeSessions } from '../../state/projectView'
import { openConsole, openView } from '../shell/navigation'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { consoleGroups } from '../shell/shellView'

export function AgentsView(p: SideBarViewProps): React.JSX.Element {
  const { t, sessions, workspaceIds, scopeId, attention, accounts } = p
  const groups = useMemo(() => consoleGroups(scopeSessions(sessions, workspaceIds, scopeId), attention), [sessions, workspaceIds, scopeId, attention])
  const rowsOf = (list: typeof sessions, icon: React.ReactNode): TreeItem[] =>
    list.map((s) => ({ id: s.id, depth: 0, label: s.title, icon, description: accounts.find((a) => a.id === s.accountId)?.label }))
  const pane = (key: string, title: string, rows: TreeItem[]): React.JSX.Element => (
    <ViewPane title={title} count={rows.length} storageKey={`agents.${key}`}>
      {rows.length === 0 ? (
        <p className="wb-view-empty">{t('shell.agents.none')}</p>
      ) : (
        <Tree label={title} rows={rows} selectedId={null} onSelect={openConsole} onOpen={openConsole} />
      )}
    </ViewPane>
  )
  return (
    <ViewContainer label={t('shell.activity.agents')}>
      <ViewToolbar
        label={t('shell.activity.agents')}
        items={[
          { id: 'new', icon: <Icon name="add" />, label: t('shell.agents.new'), disabled: !p.canStart(), onClick: () => p.setShowNew(true) },
          { id: 'wall', icon: <Icon name="layoutGrid" />, label: t('shell.agents.wall'), onClick: () => openView('wall') }
        ]}
      />
      {pane('needs', t('shell.agents.needs'), rowsOf(groups.needs, <Icon name="circleAlert" />))}
      {pane('working', t('shell.agents.working'), rowsOf(groups.working, <Icon name="loading" />))}
      {pane('finished', t('shell.agents.finished'), rowsOf(groups.finished, <Icon name="done" />))}
    </ViewContainer>
  )
}
