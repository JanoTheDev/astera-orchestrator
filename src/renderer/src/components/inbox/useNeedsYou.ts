// T19: the bell's cards and its unread count, read once for the bell and the status bar so the two numbers always match.
import type { AppState } from '../../state/appState'
import { useBellState } from './bellStore'
import { offersAllProjects, unreadCount } from './bellView'
import { useInbox, type InboxState } from './useInbox'

export type NeedsYouScope = Pick<AppState, 'scopedData' | 'scopedTree' | 'workspaceData' | 'workspaceTree'>

/** `withFeed` false reads the cards alone (the closed bell and the status bar). */
export function useNeedsYou(s: NeedsYouScope, withFeed: boolean): InboxState & { unread: number; many: boolean; read: ReadonlySet<string>; allProjects: boolean } {
  const { read, allProjects } = useBellState()
  const many = offersAllProjects(s.workspaceTree)
  const wide = many && allProjects
  const inbox = useInbox(wide ? s.workspaceTree : s.scopedTree, wide ? s.workspaceData : s.scopedData, withFeed)
  return { ...inbox, unread: unreadCount(inbox.needs, read), many, read, allProjects }
}
