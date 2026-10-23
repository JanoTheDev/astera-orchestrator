// W9-D: what `openInbox(filter?)` (components/shell/navigation.ts) asks of the Inbox page. A tiny store, so the
// handler and the page meet without App state: the handler writes the request, the page reads it.
import { useSyncExternalStore } from 'react'
import { parseFilter, type HandledLine, type InboxFilter, type NeedCard } from './inboxView'

export interface InboxRequest {
  filter: InboxFilter
}

let current: InboxRequest = { filter: { group: 'all' } }
const listeners = new Set<() => void>()
const set = (next: InboxRequest): void => {
  current = next
  listeners.forEach((l) => l())
}

/** The filter the string names (inboxView.parseFilter), for the Inbox page (Pages.tsx shows it on `page === 'inbox'`). */
export const requestInbox = (raw?: string): void => set({ filter: parseFilter(raw) })
/** Narrows or widens the shown Inbox. */
export const setInboxFilter = (filter: InboxFilter): void => set({ filter })
export const inboxRequest = (): InboxRequest => current

export function useInboxRequest(): InboxRequest {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}

/** Where a row's "Open" goes: the console of a wait (permission or waiting), else the plan tab, at the Task when it has one. */
export type OpenTarget = { kind: 'console'; sessionId: string } | { kind: 'plan'; jobId: string; taskId?: string; tab: string }

const planTarget = (jobId: string, taskId?: string): OpenTarget => ({
  kind: 'plan',
  jobId,
  ...(taskId !== undefined ? { taskId } : {}),
  tab: `view:plan:${jobId}${taskId !== undefined ? `#task-${taskId}` : ''}`
})

export function openTargetOf(c: Pick<NeedCard, 'kind' | 'jobId' | 'taskId' | 'sessionId'>): OpenTarget {
  return (c.kind === 'permission' || c.kind === 'waiting') && c.sessionId !== undefined ? { kind: 'console', sessionId: c.sessionId } : planTarget(c.jobId, c.taskId)
}

/** Where a handled line leads: its plan (its Task when it names one), else its console; none when it names neither. */
export function lineTargetOf(l: Pick<HandledLine, 'jobId' | 'taskId' | 'sessionId'>): OpenTarget | null {
  if (l.jobId !== undefined) return planTarget(l.jobId, l.taskId)
  return l.sessionId !== undefined ? { kind: 'console', sessionId: l.sessionId } : null
}

/** Scrolls the plan tab to the Task card `#task-<id>` once it has rendered (the plan opens on its next frames); gives up after ~2 s. */
export function revealTask(taskId: string, tries = 40): void {
  const el = document.getElementById(`task-${taskId}`)
  if (el) el.scrollIntoView({ block: 'center' })
  else if (tries > 0) setTimeout(() => revealTask(taskId, tries - 1), 50)
}
