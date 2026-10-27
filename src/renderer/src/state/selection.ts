// The owner's last click always wins: what decides the window's project and active tab after a pick, a tree change or
// a restore. The pane tree's active tab is the one the editor shows (scopeLayout), so a tab hidden in another project's
// workspace is never left active, and only a pick of a tab moves the project to that tab's own.
import { activateTab, firstLeaf, leafOf, type PaneNode } from '../../../core/panes/tree'
import { placeTab } from '../../../core/panes/place'
import { sessionTab, type TabRef } from '../../../core/panes/tabId'
import { entryTab, scopeLayout } from './workspaceTree'
import { selectionAfterFocus } from './projectView'

/** The owner's last pick since mount, null until there is one: a project in the switcher (or a navigation that opens
 *  a workspace) is `tabId: null`, a tab click, Ctrl+PageUp/Down or an "open this session" names its tab. A picked tab
 *  is cleared once its focus change is decided, so a later refresh or close is no pick. */
export type OwnerPick = { tabId: string | null }

/** Where the focus goes after a picked tab became active: the project it moves the selection to, 'wait' while it is a
 *  session the tree does not place yet (its owner unknown until the next poll), or null when nothing moves. A hidden
 *  session leaves the open workspace for its project's; a file, record or browser tab of another project, visible in
 *  every workspace, moves the selection to that project; All projects stays All. Only a pick moves it: a hidden tab
 *  that became active as the tree changed (a tab closing, a restore) is given up instead (focusInScope). */
export function followTarget(s: {
  picked: boolean
  tab: TabRef | null
  /** The session ids the open workspace shows, null for every tab. */
  keep: ReadonlySet<string> | null
  selected: string | null
  /** The tab's project: undefined for a session no project holds yet, null for a folder no project holds. */
  owner: string | null | undefined
}): { projectId: string | null } | 'wait' | null {
  if (!s.picked || !s.tab || s.tab.kind === 'app') return null
  if (s.tab.kind === 'session') {
    if (!s.keep || s.keep.has(s.tab.id)) return null
    return s.owner ? { projectId: s.owner } : 'wait'
  }
  const next = selectionAfterFocus(s.selected, s.owner ?? null)
  return next === s.selected ? null : { projectId: next }
}

/** The tree with its active tab one the scope shows, or null when it already is. The active pane keeps the tab its
 *  shown group has; a pane hidden whole gives the focus to the scope's remembered tab, else its first session tab,
 *  else its first tab; with nothing shown no pane is active. `keep` null (every tab) changes nothing. */
export function focusInScope(
  layout: PaneNode | null,
  activePaneId: string | null,
  keep: ReadonlySet<string> | null,
  remembered?: string,
  hidePlans?: ReadonlySet<string>
): { root: PaneNode; paneId: string | null } | null {
  if (!layout || !keep) return null
  const shown = scopeLayout(layout, keep, hidePlans)
  const pane = shown && activePaneId ? leafOf(shown, activePaneId) : null
  const tab = pane ? pane.activeTabId : (entryTab(layout, keep, remembered, hidePlans) ?? (shown ? firstLeaf(shown).activeTabId : undefined))
  if (!tab) return activePaneId === null ? null : { root: layout, paneId: null }
  const act = activateTab(layout, tab)
  return !act || (act.root === layout && act.paneId === activePaneId) ? null : act
}

/** The tab Ctrl+PageUp/Down moves to: the next one the active group shows (`shown`, the scoped tree), never a tab
 *  hidden in another workspace. Undefined when the group shows fewer than two. */
export function cycledTab(shown: PaneNode | null, activePaneId: string | null, delta: number): string | undefined {
  const group = shown && ((activePaneId && leafOf(shown, activePaneId)) || firstLeaf(shown))
  if (!group || group.tabIds.length < 2) return undefined
  const i = group.tabIds.indexOf(group.activeTabId)
  if (i < 0) return undefined
  const n = group.tabIds.length
  return group.tabIds[(i + delta + n) % n]
}

/** The selection once main names the window's bound project: that project, unless the owner picked first. */
export const selectionAfterBound = (pick: OwnerPick | null, selected: string | null, bound: string | null): string | null =>
  pick === null && bound ? bound : selected

/** The first poll's entry into the bound project and the tab it focuses there, or null once the owner has picked. */
export const boundEntry = (
  pick: OwnerPick | null,
  bound: string,
  layout: PaneNode | null,
  keep: ReadonlySet<string> | null,
  remembered?: string,
  hidePlans?: ReadonlySet<string>
): { projectId: string; tab: string | undefined } | null =>
  pick === null ? { projectId: bound, tab: entryTab(layout, keep, remembered, hidePlans) } : null

/** The startup re-adoption of running sessions as tabs, merged into the tree already there (tabs opened or placed
 *  before the list answered stay). New tabs go into the first group, in list order; `wanted` takes the focus unless
 *  the owner has picked and an active pane is there. Null with no tab at all. */
export function adoptSessions(
  tree: PaneNode | null,
  activePaneId: string | null,
  ids: readonly string[],
  wanted: string,
  pick: OwnerPick | null
): { root: PaneNode; paneId: string } | null {
  let root = tree
  for (const id of ids) root = placeTab(root, sessionTab(id), { background: true }).root
  if (!root) return null
  if (pick !== null && activePaneId && leafOf(root, activePaneId)) return { root, paneId: activePaneId }
  return activateTab(root, sessionTab(wanted))
}
