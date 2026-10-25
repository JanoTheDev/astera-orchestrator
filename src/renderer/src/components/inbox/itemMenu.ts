// The actions a notification item offers in the bell, the Inbox and the Activity tab, in one place so the three lists
// agree: open its source, open its console, mark it read/unread, copy its text. Pure; the components run the result.
import type { MessageKey } from '../../../../core/i18n'
import type { MenuItem } from '../ui'
import type { Translate } from '../checkText'
import { NEED_WORD, whereOf, type NeedCard } from './inboxView'
import type { OpenTarget } from './inboxNav'

export type ItemAction = 'open' | 'console' | 'read' | 'unread' | 'copy'
export interface ItemEntry {
  id: ItemAction
  label: MessageKey
}

/** What an item points at: where "Open" leads, its console (if any), and whether it carries a read mark. */
export interface ItemRef {
  /** Read key; absent when the list keeps no read state (Activity). */
  key?: string
  target: OpenTarget | null
  sessionId?: string
  text: string
}

/** Open (to the plan or the console, as the target says), Open console (only when it is not already the target),
 *  Mark read/unread (only when the item has a key), Copy text. */
export function itemEntriesOf(i: Pick<ItemRef, 'key' | 'target' | 'sessionId'>, read: boolean): ItemEntry[] {
  const out: ItemEntry[] = []
  if (i.target) out.push({ id: 'open', label: i.target.kind === 'console' ? 'inbox.openConsole' : 'inbox.openPlan' })
  if (i.sessionId !== undefined && i.target?.kind !== 'console') out.push({ id: 'console', label: 'inbox.openConsole' })
  if (i.key !== undefined) out.push(read ? { id: 'unread', label: 'inbox.item.markUnread' } : { id: 'read', label: 'inbox.item.markRead' })
  out.push({ id: 'copy', label: 'inbox.item.copy' })
  return out
}

export interface ItemDeps {
  open: (t: OpenTarget) => void
  console: (sessionId: string) => void
  /** Sets the read mark of one key. */
  setRead: (key: string, read: boolean) => void
  copy: (text: string) => void
}

export function runItemAction(a: ItemAction, i: ItemRef, d: ItemDeps): void {
  if (a === 'open' && i.target) d.open(i.target)
  else if (a === 'console' && i.sessionId !== undefined) d.console(i.sessionId)
  else if ((a === 'read' || a === 'unread') && i.key !== undefined) d.setRead(i.key, a === 'read')
  else if (a === 'copy') d.copy(i.text)
}

/** The entries as Menu rows. */
export const itemMenuOf = (i: ItemRef, read: boolean, d: ItemDeps, t: Translate): MenuItem[] =>
  itemEntriesOf(i, read).map((e) => ({ id: e.id, label: t(e.label), onSelect: () => runItemAction(e.id, i, d) }))

/** The text "Copy text" puts on the clipboard for a card: its kind, where it is, and the question when it has one. */
export const needTextOf = (c: NeedCard, t: Translate): string =>
  [`${t(NEED_WORD[c.kind][0])} · ${whereOf(c.projectName, c.planName, c.taskTitle)}`, c.q?.command ?? c.q?.question].filter(Boolean).join('\n')
