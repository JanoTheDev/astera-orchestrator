// DESIGN-W13 §12: the slim strip above a console tab's terminal — plan › Task as links, the account, the state, and
// Stop (keeps the tab) / End session / Restart, and the folder's open/reveal/copy menu. PaneGrid mounts it above the session's xterm only, so the wall's previews (which borrow the xterm
// alone) never show it. The terminal stays the real CLI TUI.
import { useI18n } from '../../i18n/I18nProvider'
import type { Account, SessionInfo } from '../../../../core/types'
import { sessionTab } from '../../../../core/panes/tabId'
import { Button, Icon, IconButton, Menu } from '../ui'
import { openPlan } from '../shell/navigation'
import { copyText, revealPath, stopKeepTab } from '../shell/tabActions'
import { isMac } from '../../lib/platformKeys'
import { toast } from '../../lib/toast'
import { StateChip } from './Wall'
import { useConsoleSnapshot } from './consoleStore'
import { consoleHeaderOf, consoleTitle } from './wallModel'
import { stopConsole } from './stopConsole'

export function ConsoleHeader({
  session,
  accounts,
  onRestart,
  onEnd
}: {
  session: SessionInfo
  accounts: readonly Account[]
  onRestart: (s: SessionInfo) => void
  onEnd: (tabId: string) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const c = useConsoleSnapshot().consoles.find((x) => x.sessionId === session.id)
  if (!c) return null
  const account = accounts.find((a) => a.id === c.accountId)?.label
  const h = consoleHeaderOf(c, account)
  const exited = session.status === 'exited'
  return (
    <div className="console-head" role="group" aria-label={t('agents.header.label')}>
      {h.plan ? (
        <span className="console-head__crumbs">
          <Button size="sm" variant="ghost" className="console-head__link" title={t('agents.header.plan', { name: h.plan.name })} onClick={() => openPlan(h.plan!.jobId)}>
            {h.plan.name}
          </Button>
          <Icon name="chevronRight" size={14} aria-hidden="true" />
          <Button size="sm" variant="ghost" className="console-head__link" title={t('agents.header.task', { name: h.task! })} onClick={() => openPlan(h.plan!.jobId, c.taskId ? `task-${c.taskId}` : 'waves')}>
            {h.task}
          </Button>
        </span>
      ) : (
        <Menu
          label={t('agents.header.folder')}
          items={[
            {
              id: 'open',
              label: t('agents.header.openFolder'),
              icon: <Icon name="folder" size={14} />,
              onSelect: () => void window.api.files.openFolder(session.cwd).catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
            },
            {
              id: 'reveal',
              label: t(isMac() ? 'overlays.tabMenu.revealMac' : 'overlays.tabMenu.reveal'),
              icon: <Icon name="external" size={14} />,
              onSelect: () => revealPath(session.cwd, t)
            },
            { id: 'copy', label: t('overlays.tabMenu.copyPath'), icon: <Icon name="copy" size={14} />, onSelect: () => copyText(session.cwd) }
          ]}
          trigger={{ size: 'sm', variant: 'ghost', className: 'console-head__cwd', title: h.cwd, children: h.cwd }}
        />
      )}
      <span className="console-head__end">
        {h.account && <span className="console-head__account">{h.account}</span>}
        <StateChip c={c} />
        {exited ? (
          <IconButton size="sm" label={t('agents.header.restart')} icon={<Icon name="refresh" size={14} />} onClick={() => onRestart(session)} />
        ) : (
          <>
            <IconButton size="sm" label={t('agents.row.stop')} icon={<Icon name="stop" size={14} />} onClick={() => void stopKeepTab(session, consoleTitle(c), t)} />
            <IconButton
              size="sm"
              label={t('wall.end.confirm')}
              icon={<Icon name="close" size={14} />}
              onClick={() => void stopConsole(c, true, t, () => onEnd(sessionTab(session.id)))}
            />
          </>
        )}
      </span>
    </div>
  )
}
