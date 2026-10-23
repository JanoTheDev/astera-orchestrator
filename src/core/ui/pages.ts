import type { ViewName } from '../panes/tabId'

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

/** The pages `Ctrl+1…6` open (DESIGN.md §1). T9 kept the order so saved shortcuts keep their page: Tasks opens Plans ›
 *  All tasks and Inbox the full Inbox view behind the bell. */
export const KEYED_PAGES = ['agents', 'tasks', 'plans', 'inbox', 'worktrees', 'files'] as const satisfies readonly MainPageId[]

/** T9 (DESIGN-W11 §8): the top bar's three tabs. Settings has its gear, the rest sit in More, Inbox behind the bell. */
export const TAB_PAGES = ['agents', 'plans', 'files'] as const satisfies readonly PageId[]
/** What the top bar's "More" menu lists, in its order. */
export const MORE_MENU_PAGES = ['worktrees', 'more:history', 'more:runs', 'more:hiw', 'more:browser'] as const satisfies readonly PageId[]

/** The tab a page lights: All tasks (`tasks`) is a view inside Plans; Inbox, Settings and the More pages light none. */
export function tabOf(page: PageId): (typeof TAB_PAGES)[number] | null {
  if (page === 'tasks') return 'plans'
  return (TAB_PAGES as readonly PageId[]).includes(page) ? (page as (typeof TAB_PAGES)[number]) : null
}

/** Where the open page is kept between launches (`cm.` like the app's other renderer-only keys). */
export const PAGE_STORAGE_KEY = 'cm.page'

/** The page to open on launch, from what `PAGE_STORAGE_KEY` holds. Settings, the More pages and the bell's full Inbox
 *  are not reopened:
 *  they are places one visits, and the app opens on the work (DESIGN.md §0 "The app opens on the Agents page"). */
export function initialPage(saved: string | null): PageId {
  const page = pageOf(saved)
  return page === 'settings' || page === 'inbox' || page.startsWith('more:') ? DEFAULT_PAGE : page
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

// ---- The VSCode-style workbench: activity bar views, side bar and bottom panel state ----

export const ACTIVITY_IDS = ['agents', 'plans', 'explorer', 'scm', 'history', 'run', 'devices'] as const
/** `Ctrl+1…6` open the first six activities; Devices, after them, has no digit key. */
export const KEYED_ACTIVITY_COUNT = 6
export type ActivityId = (typeof ACTIVITY_IDS)[number]
export const DEFAULT_ACTIVITY: ActivityId = 'agents'
export const ACTIVITY_STORAGE_KEY = 'cm.activity'

export const SIDEBAR_WIDTH_KEY = 'cm.sidebar.width'
export const SIDEBAR_VISIBLE_KEY = 'cm.sidebar.visible'
export const PANEL_VISIBLE_KEY = 'cm.panel.visible'
export const PANEL_TAB_KEY = 'cm.panel.tab'

export const PANEL_TABS = ['needs', 'activity', 'output', 'terminal'] as const
export type PanelTab = (typeof PANEL_TABS)[number]

export const SIDEBAR_MIN_WIDTH = 170
export const SIDEBAR_MAX_WIDTH = 600
export const SIDEBAR_DEFAULT_WIDTH = 260
export function clampSidebarWidth(n: number): number {
  if (Number.isNaN(n)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, n))
}

/** What an old saved `cm.page` opens in the workbench. Unknown values open Agents. */
export function activityOfSaved(saved: unknown): { activity: ActivityId; openView?: ViewName; panelTab?: PanelTab } {
  switch (saved) {
    case 'plans':
    case 'tasks':
      return { activity: 'plans' }
    case 'files':
      return { activity: 'explorer' }
    case 'worktrees':
      return { activity: 'scm' }
    case 'more:history':
    case 'more:hiw':
      return { activity: 'history' }
    case 'more:runs':
      return { activity: 'run' }
    case 'inbox':
      return { activity: 'agents', panelTab: 'needs' }
    default: // agents, settings (not reopened on launch), more:browser, anything unknown
      return { activity: DEFAULT_ACTIVITY }
  }
}
