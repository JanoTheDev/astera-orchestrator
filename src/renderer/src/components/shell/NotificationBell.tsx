// T9 / DESIGN-W13 §7: the bell in the status bar. The badge counts the unread "needs you" cards of the open project; the
// popover (menu-like, 22px rows) lists the newest of them, each with its one action, then the latest handled lines, and
// "View all" opens the panel's Needs you tab. The status bar's "needs you" opens it too.
import { useMemo, useState, useSyncExternalStore } from 'react'
import type { AppState } from '../../state/appState'
import { useI18n } from '../../i18n/I18nProvider'
import { approvePlan, type ActionUi } from '../../lib/jobActions'
import { localDoor } from '../../lib/orchDoor'
import { Button, Icon, IconButton, Menu, menuPointOf, type MenuItem } from '../ui'
import { Popover } from '../ui/Popover'
import { markRead, markUnread, setRead, toggleAllProjects } from '../inbox/bellStore'
import { useNeedsYou } from '../inbox/useNeedsYou'
import { NEED_WORD, ageOf, handledOf, whereOf, type HandledLine, type NeedCard } from '../inbox/inboxView'
import { BELL_ACTION_LABEL, BELL_RECENT_MAX, badgeOf, bellActionOf, bellItems, markAllRead } from '../inbox/bellView'
import { goTo } from '../inbox/InboxPage'
import { lineTargetOf, openTargetOf } from '../inbox/inboxNav'
import { itemMenuOf, needTextOf, type ItemDeps, type ItemRef } from '../inbox/itemMenu'
import { openConsole, openInbox, openPlan } from './navigation'
import '../inbox/inbox.css'

// Open or shut from anywhere (the status bar), like inboxNav's request
let opened = false
const listeners = new Set<() => void>()
export const setBellOpen = (open: boolean): void => {
  opened = open
  listeners.forEach((l) => l())
}
export const openBell = (): void => setBellOpen(true)
export const bellOpen = (): boolean => opened
/** "View all": the panel's Needs you tab, the popover shut. */
export const viewAllInbox = (): void => {
  setBellOpen(false)
  openInbox()
}
const useBellOpen = (): boolean =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => opened
  )

export type NotificationBellProps = Pick<AppState, 'accounts' | 'actionUi' | 'scopedData' | 'scopedTree' | 't' | 'workspaceData' | 'workspaceTree'>

export function NotificationBell({ accounts, actionUi, scopedData, scopedTree, t, workspaceData, workspaceTree }: NotificationBellProps): React.JSX.Element {
  const open = useBellOpen()
  const { lang } = useI18n()
  // the feed is read only while the popover shows: the badge needs the cards alone
  const { needs, events, pathOfJob, read, many, allProjects } = useNeedsYou({ scopedData, scopedTree, workspaceData, workspaceTree }, open)
  const handled = useMemo(
    () => (open ? handledOf(events, { group: 'all' }, (id) => accounts?.find((a) => a.id === id)?.label ?? id, BELL_RECENT_MAX, lang) : []),
    [open, events, accounts, lang]
  )
  const items = bellItems(needs, handled, read)
  const badge = badgeOf(items.unread)

  const [menu, setMenu] = useState<{ at: { x: number; y: number }; ref: ItemRef; read: boolean } | null>(null)
  const deps: ItemDeps = {
    open: (target) => {
      setBellOpen(false)
      goTo(target)
    },
    console: (id) => {
      setBellOpen(false)
      openConsole(id)
    },
    setRead: (key, r) => (r ? markRead(key) : markUnread(key)),
    copy: (text) => window.api.clipboard.writeText(text)
  }
  const needRef = (c: NeedCard): ItemRef => ({ key: c.key, target: openTargetOf(c), sessionId: c.sessionId, text: needTextOf(c, t) })
  const lineRef = (l: HandledLine): ItemRef => ({ key: l.id, target: lineTargetOf(l), sessionId: l.sessionId, text: l.text })

  const act = (c: NeedCard, ui: ActionUi): void => {
    markRead(c.key)
    const action = bellActionOf(c)
    if (action === 'approve') {
      void approvePlan(localDoor(window.api, pathOfJob.get(c.jobId) ?? ''), c.jobId, c.planName, ui)
      return
    }
    setBellOpen(false)
    if (action === 'answer') openInbox(`plan:${c.jobId}`)
    else if (c.sessionId) openConsole(c.sessionId)
    else openPlan(c.jobId)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setBellOpen}
      label={t('bell.title')}
      className="tb-bell"
      panelClassName="tb-popover bell"
      trigger={(tp) => (
        <IconButton
          {...tp}
          className="tb-bell__btn"
          active={open}
          label={items.unread > 0 ? t('bell.labelCount', { n: items.unread }) : t('bell.title')}
          icon={
            <>
              <Icon name="notifications" />
              {badge && (
                <span className="tb-bell-badge" aria-hidden="true">
                  {badge}
                </span>
              )}
            </>
          }
        />
      )}
    >
      <BellPanel
        needs={items.needs}
        recent={items.recent}
        read={read}
        nowMs={Date.now()}
        t={t}
        allProjects={many ? { on: allProjects, toggle: toggleAllProjects } : undefined}
        onMarkAllRead={() => {
          setRead(markAllRead(needs, handled))
        }}
        onAct={(c) => act(c, actionUi)}
        onLine={(l) => {
          const target = lineTargetOf(l)
          if (!target) return
          markRead(l.id)
          deps.open(target)
        }}
        onOpen={(c) => {
          markRead(c.key)
          deps.open(openTargetOf(c))
        }}
        onToggleRead={(key, isRead) => deps.setRead(key, !isRead)}
        onMenu={(e, which, isRead) => {
          e.preventDefault()
          setMenu({ at: menuPointOf(e), ref: 'id' in which ? lineRef(which) : needRef(which), read: isRead })
        }}
        menu={menu ? { at: menu.at, items: itemMenuOf(menu.ref, menu.read, deps, t) } : null}
        onMenuClose={() => setMenu(null)}
        onViewAll={viewAllInbox}
      />
    </Popover>
  )
}

const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The popover's content, hook-free so the node-only suite renders it. Every row's control is `data-roving`, so the
 *  Popover's arrow keys walk them top to bottom. */
export function BellPanel({
  needs,
  recent,
  read,
  nowMs,
  t,
  allProjects,
  onMarkAllRead,
  onAct,
  onLine,
  onOpen,
  onToggleRead,
  onMenu,
  menu,
  onMenuClose,
  onViewAll
}: {
  needs: readonly NeedCard[]
  recent: readonly HandledLine[]
  read: ReadonlySet<string>
  nowMs: number
  t: AppState['t']
  /** Present only when there is more than one project. */
  allProjects?: { on: boolean; toggle: () => void }
  onMarkAllRead: () => void
  onAct: (c: NeedCard) => void
  onLine: (l: HandledLine) => void
  /** Open the card's source, beside its one action. */
  onOpen: (c: NeedCard) => void
  onToggleRead: (key: string, read: boolean) => void
  /** Right-click on a card or a line. */
  onMenu: (e: React.MouseEvent, item: NeedCard | HandledLine, read: boolean) => void
  menu: { at: { x: number; y: number }; items: MenuItem[] } | null
  onMenuClose: () => void
  onViewAll: () => void
}): React.JSX.Element {
  return (
    <div className="bell__body">
      <div className="bell__head">
        <h2 className="bell__title">{t('bell.title')}</h2>
        {allProjects && (
          <Button size="sm" variant="ghost" data-roving="" aria-pressed={allProjects.on} onClick={allProjects.toggle}>
            {t('bell.allProjects')}
          </Button>
        )}
        <Button size="sm" variant="ghost" data-roving="" disabled={needs.length === 0 && recent.length === 0} onClick={onMarkAllRead}>
          {t('bell.markAllRead')}
        </Button>
      </div>
      <section aria-label={t('bell.needsYou')}>
        <h3 className="bell__h">{t('bell.needsYou')}</h3>
        {needs.length === 0 ? (
          <p className="bell__none">{t('inbox.nothingNeeds')}</p>
        ) : (
          <ul className="bell__list">
            {needs.map((c) => {
              const [word, tone] = NEED_WORD[c.kind]
              const action = bellActionOf(c)
              return (
                <li key={c.key} className={read.has(c.key) ? 'bell__item' : 'bell__item bell__item--unread'} onContextMenu={(e) => onMenu(e, c, read.has(c.key))}>
                  <span className={`bell__kind bell__kind--${tone}`}>{t(word)}</span>
                  <span className="bell__where" title={whereOf(c.projectName, c.planName, c.taskTitle)}>
                    {whereOf(c.projectName, c.planName, c.taskTitle)}
                  </span>
                  <span className="bell__age">{ageOf(c.at, nowMs, t)}</span>
                  <IconButton size="sm" data-roving="" icon={<Icon name="open" size={14} />} label={t('bell.open')} onClick={() => onOpen(c)} />
                  <IconButton
                    size="sm"
                    data-roving=""
                    icon={<Icon name={read.has(c.key) ? 'pending' : 'check'} size={14} />}
                    label={t(read.has(c.key) ? 'inbox.item.markUnread' : 'inbox.item.markRead')}
                    onClick={() => onToggleRead(c.key, read.has(c.key))}
                  />
                  <Button size="sm" variant={action === 'approve' ? 'primary' : 'secondary'} data-roving="" onClick={() => onAct(c)}>
                    {t(BELL_ACTION_LABEL[action])}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {recent.length > 0 && (
        <section aria-label={t('bell.recent')}>
          <h3 className="bell__h">{t('bell.recent')}</h3>
          <ul className="bell__list">
            {recent.map((l) => (
              <li key={l.id} onContextMenu={(e) => onMenu(e, l, read.has(l.id))}>
                <Button variant="ghost" size="sm" className="bell__line" data-roving="" disabled={lineTargetOf(l) === null} title={l.text} onClick={() => onLine(l)}>
                  <span className="bell__text">{l.text}</span>
                  {l.plan && <span className="bell__plan">{l.plan}</span>}
                  <span className="bell__age">{timeOf(l.at)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="bell__foot">
        <Button size="sm" variant="ghost" data-roving="" onClick={onViewAll}>
          {t('bell.viewAll')}
        </Button>
      </div>
      {menu && <Menu at={menu.at} items={menu.items} onClose={onMenuClose} label={t('bell.title')} />}
    </div>
  )
}
