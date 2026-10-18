// W9-D: what `openInbox(filter?)` (components/shell/navigation.ts) asks of the Inbox page. A tiny store, so the
// handler and the page meet without App state: the handler writes the request, the page reads it.
import { useSyncExternalStore } from 'react'
import { parseFilter, type InboxFilter } from './inboxView'

export interface InboxRequest {
  /** Whether the Inbox is shown. The page host (W9-B's page switch; until then Overlays) reads it. */
  open: boolean
  filter: InboxFilter
}

let current: InboxRequest = { open: false, filter: { group: 'all' } }
const listeners = new Set<() => void>()
const set = (next: InboxRequest): void => {
  current = next
  listeners.forEach((l) => l())
}

/** Shows the Inbox with the filter the string names (inboxView.parseFilter). */
export const requestInbox = (raw?: string): void => set({ open: true, filter: parseFilter(raw) })
export const closeInbox = (): void => set({ ...current, open: false })
/** Narrows or widens the shown Inbox without closing it. */
export const setInboxFilter = (filter: InboxFilter): void => set({ ...current, filter })
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
