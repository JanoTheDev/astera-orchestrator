// DESIGN-W13 §9: what Ctrl+P (quick open) shows. The box's text picks the list: `>` the commands, `@` Tasks, else tabs,
// plans, files and consoles, each in a labelled section. The searches are boxHits.ts's and tabSwitcher.ts's (one engine);
// this only orders their answers. Pure.
import { rankByFields } from '../../../../core/orchestration/sessionIndex'
import { filterSwitcherTabs, type SwitcherTab } from '../../lib/tabSwitcher'
import type { BoxHit } from './boxHits'

export type QuickMode = 'commands' | 'tasks' | 'open'

/** The mode a text asks for, and the text left to search once its prefix is off. */
export function quickModeOf(text: string): { mode: QuickMode; query: string } {
  const s = text.trimStart()
  if (s.startsWith('>')) return { mode: 'commands', query: s.slice(1).trim() }
  if (s.startsWith('@')) return { mode: 'tasks', query: s.slice(1).trim() }
  return { mode: 'open', query: s.trim() }
}

/** The sections of the open list, in the order they are drawn. `help` is the in-app help, found by its name. */
export const QUICK_SECTIONS = ['tab', 'plan', 'file', 'console', 'help'] as const
export type QuickSection = (typeof QUICK_SECTIONS)[number]

export type QuickRow =
  | { section: 'tab'; key: string; title: string; where: string; tabId: string }
  | { section: 'plan'; key: string; title: string; where: string; jobId: string }
  | { section: 'file'; key: string; title: string; where: string; path: string }
  | { section: 'console'; key: string; title: string; where: string; sessionId: string; waiting: boolean }
  | { section: 'help'; key: string; title: string; where: string }

/** Most rows of each section: the list is a place to pick from, not a report. */
export const PER_SECTION = 6

/** The folder part of a root-relative path ("src/app/main.ts" → "src/app"), or the project's root. */
const dirOf = (rel: string): string => rel.slice(0, Math.max(0, rel.lastIndexOf('/')))

/**
 * The rows for `query` in section order. Tabs come from the open tabs (all of them, in strip order, while nothing is
 * typed); plans, consoles and help from the box's hits; files from the project's file index. Anything the search did
 * not find is simply absent, so an empty section has no label.
 */
export function quickRows(src: { tabs: readonly SwitcherTab[]; hits: readonly BoxHit[]; files: readonly string[] }, query: string): QuickRow[] {
  const q = query.trim()
  const tabs = filterSwitcherTabs(src.tabs, q).slice(0, q === '' ? 12 : PER_SECTION)
  if (q === '') return tabs.map(tabRow)
  return [
    ...tabs.map(tabRow),
    ...src.hits.flatMap((h): QuickRow[] => (h.kind === 'plan' ? [{ section: 'plan', key: h.key, title: h.title, where: h.where, jobId: h.jobId }] : [])),
    ...src.files.slice(0, PER_SECTION).map((path): QuickRow => ({ section: 'file', key: `f:${path}`, title: path.slice(path.lastIndexOf('/') + 1), where: dirOf(path), path })),
    ...src.hits.flatMap((h): QuickRow[] =>
      h.kind === 'session' ? [{ section: 'console', key: h.key, title: h.title, where: h.where, sessionId: h.sessionId, waiting: h.waiting }] : []
    ),
    ...src.hits.flatMap((h): QuickRow[] => (h.kind === 'help' ? [{ section: 'help', key: h.key, title: h.title, where: h.where }] : []))
  ]
}

function tabRow(tab: SwitcherTab): QuickRow {
  return {
    section: 'tab',
    key: `tab:${tab.tabId}`,
    title: tab.label ?? tab.title,
    where: [tab.label ? tab.title : '', tab.taskTitle, tab.planName, tab.projectName].filter(Boolean).join(' · '),
    tabId: tab.tabId
  }
}

/** Where each section starts in `rows`, for the labels (a row whose section differs from the one above it opens one). */
export const startsSection = (rows: readonly QuickRow[], i: number): boolean => i === 0 || rows[i - 1].section !== rows[i].section

/** How many commands the palette remembers as recently used. */
export const RECENT_MAX = 5

/** `id` moved to the front of the recent list, the list kept to RECENT_MAX. */
export const pushRecent = (recent: readonly string[], id: string): string[] => [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_MAX)

/**
 * The palette's commands for `query`, best match first. With nothing typed the recently used come first (newest first),
 * then the rest in the registry's order; `recents` says how many of the rows lead that way.
 */
export function rankCommands<T extends { id: string }>(
  commands: readonly T[],
  query: string,
  recent: readonly string[],
  fieldsOf: (c: T) => string[]
): { rows: T[]; recents: number } {
  if (query.trim() !== '') return { rows: rankByFields(commands, query, fieldsOf, Infinity), recents: 0 }
  const used = recent.flatMap((id) => commands.filter((c) => c.id === id))
  return { rows: [...used, ...commands.filter((c) => !recent.includes(c.id))], recents: used.length }
}
