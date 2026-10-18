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

// ---- W9-B: the shell's use of the ids ----

/** The pages `Ctrl+1…6` open, in the top bar's order (DESIGN.md §1). Settings has its ⚙, More its menu. */
export const KEYED_PAGES = ['agents', 'tasks', 'plans', 'inbox', 'worktrees', 'files'] as const satisfies readonly MainPageId[]

/** Where the open page is kept between launches (`cm.` like the app's other renderer-only keys). */
export const PAGE_STORAGE_KEY = 'cm.page'

/** The page to open on launch, from what `PAGE_STORAGE_KEY` holds. Settings and the More pages are not reopened:
 *  they are places one visits, and the app opens on the work (DESIGN.md §0 "The app opens on the Agents page"). */
export function initialPage(saved: string | null): PageId {
  const page = pageOf(saved)
  return page === 'settings' || page.startsWith('more:') ? DEFAULT_PAGE : page
}

/** The old sidebar views' keys (Ctrl+Shift+A/E/J/H) open their page; pressed on that page they go back to Agents,
 *  the rule the sidebar toggles had ("a key that opens something puts things back when pressed again"). */
export function togglePage(current: PageId, target: PageId): PageId {
  return current === target ? DEFAULT_PAGE : target
}

/** The sidebar flags the app's effects still read (`explorerOpen`, `jobsOpen`, `hiwOpen`: the Jobs snapshot and How
 *  It Works poll only while they are on), set from the page that shows that view now. */
export function viewFlagsOf(page: PageId): { explorer: boolean; jobs: boolean; understanding: boolean } {
  return { explorer: page === 'files', jobs: page === 'plans' || page === 'tasks', understanding: page === 'more:hiw' }
}
