// W9-D: what `openInbox(filter?)` (components/shell/navigation.ts) asks of the Inbox page. A tiny store, so the
// handler and the page meet without App state: the handler writes the request, the page reads it.
import { useSyncExternalStore } from 'react'
import { parseFilter, type InboxFilter } from './inboxView'

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
