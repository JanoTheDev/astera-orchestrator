// W9-B: what the top bar and the status bar say (DESIGN.md §1). Pure, so the node-only test suite reaches it.
import type { Account, AccountPlan, AccountUsage, Attention, JobRow } from '../../../../core/types'
import type { Job, JobRun, Task } from '../../../../core/orchestration/types'
import { afterNameOf, afterQueued, afterStandOf } from '../../../../core/orchestration/after'
import { jobNameOf } from '../../../../core/orchestration/jobName'
import { agentPanes, type WallConsole } from '../wall/wallModel'
import { hasSessionWindow } from '../sessionWindow'
import type { Translate } from '../checkText'
import {
  ACTIVITY_IDS, ACTIVITY_STORAGE_KEY, PAGE_STORAGE_KEY, PANEL_TABS, PANEL_TAB_KEY, PANEL_VISIBLE_KEY, SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_VISIBLE_KEY, SIDEBAR_WIDTH_KEY, activityOfSaved, clampSidebarWidth, type ActivityId, type PanelTab
} from '../../../../core/ui/pages'

export interface ShellCounts {
  /** Live consoles: a session whose process still runs. */
  consoles: number
  /** Of those, the ones at work right now (attention `working`). */
  working: number
  /** What waits on the owner: the Inbox's "needs you" items (core/orchestration/sessionIndex.ts needsInput). */
  waiting: number
  /** The Agents badge: the Needs you pane's rows (agentPanes over the same consoles), of the same scope. */
  agents: number
}

/** The consoles of the given sessions: the one scope filter of the Agents view's panes and the Agents badge. */
export function consolesOfSessions(consoles: readonly WallConsole[], sessions: readonly { id: string }[]): WallConsole[] {
  const ids = new Set(sessions.map((s) => s.id))
  return consoles.filter((c) => ids.has(c.sessionId))
}

export function shellCounts(
  sessions: readonly { id: string; status: string }[],
  attention: Readonly<Record<string, Attention>>,
  needsYou: readonly unknown[],
  consoles: readonly WallConsole[]
): ShellCounts {
  const live = sessions.filter((s) => s.status === 'running')
  return {
    consoles: live.length,
    working: live.filter((s) => attention[s.id] === 'working').length,
    waiting: needsYou.length,
    agents: agentPanes(consolesOfSessions(consoles, sessions)).needs.length
  }
}

/** "Next: X starts after Y delivers" (W8-C `Job.after`): the oldest still-queued plan, "+N" for the rest, or null when
 *  nothing is queued. A plan whose predecessor stopped says so: it will not start by itself. */
export function nextQueuedLine(s: { jobs: readonly Job[]; runs: readonly JobRun[]; tasks: readonly Task[] }, t: Translate): string | null {
  const queued = s.jobs.filter(afterQueued).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const job = queued[0]
  if (!job) return null
  const state = { jobs: [...s.jobs], runs: [...s.runs], tasks: [...s.tasks] }
  const after = afterNameOf(state, job.after!)
  const line = t(afterStandOf(state, job.after!) === 'stopped' ? 'shell.next.waits' : 'shell.next.after', { plan: jobNameOf(job), after })
  return queued.length > 1 ? `${line} (+${queued.length - 1})` : line
}

/** The status bar's two usage figures, in percent. `five` is absent for an account with no 5-hour window (Ultra, or a
 *  weekly-only reading: components/sessionWindow.ts), so the status bar draws no "5h" for it. */
export function statusUsageOf(
  plan: Pick<AccountPlan, 'hasSessionWindow'> | null | undefined,
  usage: Pick<AccountUsage, 'session' | 'weekly'> | null | undefined
): { five: number | undefined; week: number | undefined } {
  const sessionWindow = hasSessionWindow(plan, usage)
  return { five: sessionWindow ? usage?.session?.usedPercent : undefined, week: usage?.weekly?.usedPercent }
}

/** The account the status bar and the top-bar meter show: the focused console's, else the first one. */
export function activeAccountOf(accounts: readonly Account[], focusedAccountId: string | undefined): Account | undefined {
  return accounts.find((a) => a.id === focusedAccountId) ?? accounts[0]
}

// ---- DESIGN-W13: the workbench's own state (activity, side bar, panel), read from and written to localStorage ----

/** What the workbench reads at launch. A missing or broken value falls back to its default. */
export interface WorkbenchLayout {
  activity: ActivityId
  sidebarVisible: boolean
  sidebarWidth: number
  panelVisible: boolean
  panelTab: PanelTab
}

type Read = (key: string) => string | null

const isActivity = (v: unknown): v is ActivityId => (ACTIVITY_IDS as readonly unknown[]).includes(v)

/** The activity to open on: `cm.activity`, else the old shell's `cm.page` mapped by activityOfSaved. */
export function activityOnLaunch(read: Read): ActivityId {
  const saved = read(ACTIVITY_STORAGE_KEY)
  if (isActivity(saved)) return saved
  return activityOfSaved(saved ?? read(PAGE_STORAGE_KEY)).activity
}

export function readWorkbenchLayout(read: Read): WorkbenchLayout {
  const panelTab = read(PANEL_TAB_KEY)
  const width = read(SIDEBAR_WIDTH_KEY)
  return {
    activity: activityOnLaunch(read),
    sidebarVisible: read(SIDEBAR_VISIBLE_KEY) !== 'false',
    sidebarWidth: width === null ? SIDEBAR_DEFAULT_WIDTH : clampSidebarWidth(Number(width)),
    panelVisible: read(PANEL_VISIBLE_KEY) === 'true',
    panelTab: (PANEL_TABS as readonly unknown[]).includes(panelTab) ? (panelTab as PanelTab) : 'needs'
  }
}

/** localStorage, or nothing when the window has none (a private profile): the workbench then keeps its state in memory. */
export const storageRead: Read = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export function storageWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // no storage: remembered for this run only
  }
}

/** A click on an activity item (VSCode): the active one with the side bar showing collapses it; any other shows it. */
export function activityClick(cur: { activity: ActivityId; sidebarVisible: boolean }, clicked: ActivityId): { activity: ActivityId; sidebarVisible: boolean } {
  return { activity: clicked, sidebarVisible: !(cur.sidebarVisible && cur.activity === clicked) }
}

/** The panel tab shown: Needs you and Activity are their own; Output and Terminal follow the console strip's tab
 *  (`run`, or a terminal id), so a run start or a new terminal lands on the right one. */
export function shownPanelTab(panelTab: PanelTab, bottomTab: string): PanelTab {
  if (panelTab === 'needs' || panelTab === 'activity' || panelTab === 'console') return panelTab
  return bottomTab === 'run' ? 'output' : 'terminal'
}

/** The Plans activity badge: plans running now (not archived, not paused, outcome running). */
export function runningPlans(rows: readonly Pick<JobRow, 'archivedAt' | 'paused' | 'outcome'>[]): number {
  return rows.filter((r) => r.archivedAt === undefined && !r.paused && r.outcome === 'running').length
}
