// The pages of the Wave 9 shell (DESIGN.md §2, PLAN.md "Wave 9 contracts") and how saved state from the
// sidebar shell maps onto them. W9-A only defines the ids and the mapping; the pages themselves arrive
// in 9.2, and navigation goes through components/shell/navigation.ts.

/** The pages the top bar switches between. Start is not here: it is a mode of New and of an empty
 *  project, not a tab. */
export const PAGE_IDS = ['agents', 'tasks', 'plans', 'inbox', 'worktrees', 'files', 'settings'] as const
/** Upstream features that stay behind "More ▾". */
export const MORE_PAGE_IDS = ['more:history', 'more:hiw', 'more:browser', 'more:runs'] as const

export type MainPageId = (typeof PAGE_IDS)[number]
export type MorePageId = (typeof MORE_PAGE_IDS)[number]
export type PageId = MainPageId | MorePageId

/** The page the app opens on (DESIGN.md §1: "The app opens on the Agents page"). */
export const DEFAULT_PAGE: PageId = 'agents'

export function isPageId(v: unknown): v is PageId {
  return typeof v === 'string' && ((PAGE_IDS as readonly string[]).includes(v) || (MORE_PAGE_IDS as readonly string[]).includes(v))
}

/** A saved `sidebarPane` from the sidebar shell (DESIGN.md §13): `explorer` → files, every other value
 *  (sessions, jobs, understanding, or anything unknown) → agents. */
export function pageOfSidebarPane(pane: unknown): PageId {
  return pane === 'explorer' ? 'files' : DEFAULT_PAGE
}

/** A page id read from saved state: a known id is kept, an old sidebar pane maps by pageOfSidebarPane. */
export function pageOf(saved: unknown): PageId {
  return isPageId(saved) ? saved : pageOfSidebarPane(saved)
}
