// DESIGN-W13 §3: the activity bar. The side bar views in ACTIVITY_IDS order (the first six on Ctrl+1…6), then Accounts (the
// account and usage popover) and Manage (Settings, Keyboard shortcuts, Help, Check for updates) at the bottom.
// Clicking the active view collapses the side bar, as VSCode does (shellView.ts activityClick).
import { useState, useSyncExternalStore } from 'react'
import { ACTIVITY_IDS, KEYED_ACTIVITY_COUNT, type ActivityId } from '../../../../core/ui/pages'
import type { MessageKey } from '../../../../core/i18n'
import { ActivityBarItem, Icon, Menu, Popover, nextFocusIndex, type IconName, type MenuItem } from '../ui'
import { AccountPanel } from '../AccountPanel'
import { setHelpOpen } from '../help/helpStore'
import { openView } from './navigation'
import { devicesBadge } from '../devices/devicesView'
import { useDevices } from '../devices/useDevices'
import type { AppState } from '../../state/appState'

export const ACTIVITY_META: Record<ActivityId, { icon: IconName; label: MessageKey }> = {
  agents: { icon: 'terminalSquare', label: 'shell.activity.agents' },
  plans: { icon: 'listTree', label: 'shell.activity.plans' },
  explorer: { icon: 'files', label: 'shell.activity.explorer' },
  scm: { icon: 'branch', label: 'shell.activity.scm' },
  history: { icon: 'history', label: 'shell.activity.history' },
  run: { icon: 'run', label: 'shell.activity.run' },
  devices: { icon: 'laptop', label: 'shell.activity.devices' },
  prs: { icon: 'pullRequest', label: 'shell.activity.prs' }
}

// The accounts popover opens from here and from the status bar's usage item: one open state for both.
let accountsOpen = false
const listeners = new Set<() => void>()
export const setAccountsOpen = (open: boolean): void => {
  accountsOpen = open
  listeners.forEach((l) => l())
}
const useAccountsOpen = (): boolean =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => accountsOpen
  )

/** The Manage menu's rows (DESIGN-W13 §3). */
export function manageItems(t: AppState['t']): MenuItem[] {
  return [
    { id: 'settings', icon: <Icon name="settings" />, label: t('settings.title'), onSelect: () => openView('settings') },
    { id: 'keys', icon: <Icon name="keyboard" />, label: t('shell.manage.keys'), onSelect: () => openView('settings', 'keys') },
    { id: 'help', icon: <Icon name="info" />, label: t('help.title'), onSelect: () => setHelpOpen(true) },
    { id: 'update', icon: <Icon name="refresh" />, label: t('shell.manage.checkUpdates'), onSelect: () => void window.api.update.check() }
  ]
}

export type ActivityBarProps = Pick<AppState, 't' | 'accounts' | 'activity' | 'sidebarOpen'> & {
  /** Badge counts by view: Agents' needs-you consoles, Plans' running plans. */
  badges: Partial<Record<ActivityId, number>>
  onActivity: (id: ActivityId) => void
}

export function ActivityBar({ t, accounts, activity, sidebarOpen, badges, onActivity }: ActivityBarProps): React.JSX.Element {
  const open = useAccountsOpen()
  // Devices counts its own: the paired devices that are offline or have an account to sign in
  const devices = useDevices()
  const badgeOf = (id: ActivityId): number | undefined => (id === 'devices' ? devicesBadge(devices.paired ?? [], devices.accountsOf) : badges[id])
  const [manageAt, setManageAt] = useState<{ x: number; y: number } | null>(null)
  // vertical tablist: arrows move between the items, Enter/Space activate (native buttons)
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.ui-activity'))
    const next = nextFocusIndex(items.indexOf(document.activeElement as HTMLElement), items.length, e.key, 'vertical')
    if (next === null) return
    e.preventDefault()
    items[next]?.focus()
  }
  return (
    <nav className="wb-activitybar" aria-label={t('shell.activity.label')} onKeyDown={onKeyDown}>
      <div className="wb-activitybar__top" role="tablist" aria-orientation="vertical" aria-label={t('shell.activity.label')}>
        {ACTIVITY_IDS.map((id, i) => (
          <ActivityBarItem
            key={id}
            role="tab"
            aria-selected={sidebarOpen && activity === id}
            icon={<Icon name={ACTIVITY_META[id].icon} size={20} />}
            label={i < KEYED_ACTIVITY_COUNT ? `${t(ACTIVITY_META[id].label)} (Ctrl+${i + 1})` : t(ACTIVITY_META[id].label)}
            active={sidebarOpen && activity === id}
            badge={badgeOf(id)}
            onClick={() => onActivity(id)}
          />
        ))}
      </div>
      <div className="wb-activitybar__bottom">
        <Popover
          open={open}
          onOpenChange={setAccountsOpen}
          label={t('settings.tab.accounts')}
          className="wb-accounts"
          panelClassName="tb-popover wb-accounts__pop"
          trigger={(tp) => <ActivityBarItem {...tp} icon={<Icon name="circleUser" size={20} />} label={t('shell.activity.accounts')} active={open} />}
        >
          <AccountPanel accounts={accounts} onClose={() => setAccountsOpen(false)} />
        </Popover>
        <ActivityBarItem
          icon={<Icon name="settings" size={20} />}
          label={t('shell.activity.manage')}
          aria-haspopup="menu"
          aria-expanded={manageAt !== null}
          active={manageAt !== null}
          onMouseDown={(e) => manageAt && e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setManageAt((v) => (v ? null : { x: r.right, y: r.top }))
          }}
        />
        {manageAt && <Menu at={manageAt} onClose={() => setManageAt(null)} label={t('shell.activity.manage')} items={manageItems(t)} />}
      </div>
    </nav>
  )
}
