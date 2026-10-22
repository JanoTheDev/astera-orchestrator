// T9: what the top bar's notification bell shows (DESIGN-W11 §8 "Bell"). Pure, so the node-only suite reaches it; the
// cards and lines are the Inbox's own (inboxView.ts), so the bell and "View all" never disagree.
import { OTHER_WORKSPACE, type WorkspaceProject } from '../../state/workspaceTree'
import type { HandledLine, NeedCard } from './inboxView'

/** Decision 11: the newest 8 "needs you" first, then a few handled lines. */
export const BELL_NEEDS_MAX = 8
export const BELL_RECENT_MAX = 5
/** The items marked read, kept like the app's other renderer-only prefs (`cm.`). */
export const BELL_READ_KEY = 'cm.bell.read'

/** The badge: the unread "needs you" count, none at 0, "9+" above 9. */
export const badgeOf = (n: number): string | null => (n <= 0 ? null : n > 9 ? '9+' : String(n))

/** What the popover lists. `unread` counts every unread card, also the ones past the first 8. */
export function bellItems(needs: readonly NeedCard[], handled: readonly HandledLine[], read: ReadonlySet<string>): { needs: NeedCard[]; recent: HandledLine[]; unread: number } {
  return {
    needs: [...needs].reverse().slice(0, BELL_NEEDS_MAX),
    recent: handled.slice(0, BELL_RECENT_MAX),
    unread: needs.filter((c) => !read.has(c.key)).length
  }
}

/** The one inline action a card offers in the bell: a question is answered in the Inbox, a plan approved here, a wait
 *  opened in its console. */
export type BellAction = 'answer' | 'approve' | 'open'
export function bellActionOf(c: NeedCard): BellAction {
  if (c.kind === 'approval') return 'approve'
  return c.kind === 'permission' || c.kind === 'waiting' ? 'open' : 'answer'
}

/** "All projects" is offered only when there is more than one project to widen to. */
export const offersAllProjects = (tree: readonly WorkspaceProject[]): boolean => tree.filter((p) => p.id !== OTHER_WORKSPACE).length > 1

/** The read keys after "Mark all read", pruned to what is still listed so the stored set does not grow. */
export const markAllRead = (needs: readonly NeedCard[], recent: readonly HandledLine[]): string[] => [...needs.map((c) => c.key), ...recent.map((l) => l.id)]

export function loadRead(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Set<string> {
  try {
    const raw = JSON.parse(storage?.getItem(BELL_READ_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveRead(keys: readonly string[], storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(BELL_READ_KEY, JSON.stringify(keys))
  } catch {
    /* no storage: read marks last until the window closes */
  }
}
