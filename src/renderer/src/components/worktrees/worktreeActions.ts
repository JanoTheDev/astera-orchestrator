// T6: which of the worktree tab's actions show, and why one is off. Pure, so the rules are tested without the tab.
import type { PrInfo } from '../../../../core/github/types'
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
