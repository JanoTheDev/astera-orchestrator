// T6: which of the worktree tab's actions show, and why one is off. Pure, so the rules are tested without the tab.
import type { PrInfo } from '../../../../core/github/types'
import { shellQuote } from '../devices/devicesView'
import type { WorktreeStatus } from '../../../../core/types'
import type { MessageKey } from '../../../../core/i18n'

export interface ActionFacts {
  /** The folder answers (status `ok`). */
  ok: boolean
  ghConnected: boolean
  /** Commits ahead of the base; null: unknown (never read as none). */
  ahead: number | null
  /** Uncommitted changes; null: unknown. */
  dirty: number | null
  /** The branch's pull request, when GitHub knows one. */
  pr: PrInfo | undefined
  /** The folder is a plan Run's own integration folder whose work has not landed: `run-deliver --as push` acts on it. */
  pushable: boolean
  /** Another action of the tab is running. */
  busy: boolean
}

/** `show` false: the action does not apply, draw nothing. `reason`: why a shown action is off (its tooltip). */
export interface Gate {
  show: boolean
  reason?: MessageKey
}

export interface WorktreeActions {
  createPr: Gate
  viewPr: Gate
  mergePr: Gate
  mergeBase: Gate
}

export function worktreeActions(f: ActionFacts): WorktreeActions {
  const open = f.pr?.state === 'open' ? f.pr : undefined
  const off = (reason: MessageKey | undefined): Gate => (reason ? { show: true, reason } : { show: true })
  return {
    createPr: open
      ? { show: false }
      : off(!f.ok ? 'worktrees.act.unreachable' : f.busy ? 'worktrees.act.busy' : !f.ghConnected ? 'worktree.push.ghDisconnected' : f.ahead === 0 ? 'worktree.push.noCommits' : undefined),
    viewPr: { show: open !== undefined },
    mergePr: open
      ? off(!f.ghConnected ? 'worktree.push.ghDisconnected' : f.busy ? 'worktrees.act.busy' : open.isDraft ? 'worktrees.act.prDraft' : open.checks === 'failing' ? 'worktrees.act.prFailing' : undefined)
      : { show: false },
    mergeBase: f.pushable
      ? off(!f.ok ? 'worktrees.act.unreachable' : f.busy ? 'worktrees.act.busy' : f.dirty === null ? 'worktrees.act.dirtyUnknown' : f.dirty > 0 ? 'worktrees.act.dirty' : f.ahead === 0 ? 'worktree.push.noCommits' : undefined)
      : { show: false }
  }
}

export type MenuActionId = 'openHere' | 'openFiles' | 'terminal' | 'reveal' | 'copyPath' | 'viewPr' | 'copyPr' | 'remove'

/** The worktree's own actions (not the review buttons above), one list for the tab menu and the side-bar row menu.
 *  A folder that does not answer (orphan, unreachable, unchecked) offers only what needs no git: copy its path, delete it.
 *  The PR actions follow the PR in every state: a merged or closed PR keeps its link. */
export function worktreeMenu(f: { status: WorktreeStatus; pr: PrInfo | undefined }): MenuActionId[] {
  if (f.status !== 'ok') return ['copyPath', 'remove']
  return ['openHere', 'openFiles', 'terminal', 'reveal', 'copyPath', ...(f.pr ? (['viewPr', 'copyPr'] as const) : []), 'remove']
}

/** What a new bottom-panel terminal types to land in the worktree: the panel lists terminals of the project root only. */
export const cdCommand = (path: string): string => `cd ${shellQuote(path)}`
