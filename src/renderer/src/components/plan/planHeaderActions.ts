// T3 plan page header: which buttons stand visible by the plan's state. A plan that runs or waits keeps Approve,
// Pause/Resume and Open consoles; a finished plan shows Open PR (or its branch), Archive (or Unarchive) and Copy plan ID.
// The rare actions stay in the ⋯ menu. Exactly one of them is the filled primary. Pure, so the node-only suite reaches it.
import type { JobRow } from '../../../../core/types'
import { approveViewOf } from './planPage'
import { isFinishedOutcome } from './planSummary'

export type HeaderRow = Pick<
  JobRow,
  'outcome' | 'archivedAt' | 'pendingStart' | 'schedule' | 'pr' | 'planned' | 'planReady' | 'autoApprove' | 'handsOff' | 'planProblems' | 'tasks'
>

export interface HeaderActions {
  /** The finished-state group (Open PR, Archive, Copy ID) replaces Open consoles, which moves into ⋯. */
  finished: boolean
  approve: boolean
  /** Open consoles as a visible button; otherwise it is a ⋯ item. */
  consoles: boolean
  /** The PR opens in the browser; a branch (a project with no remote) copies its name. */
  openPr?: { kind: 'pr'; url: string } | { kind: 'branch'; branch: string }
  /** Archive or Unarchive as a visible button (this computer's plans only); otherwise it stays in ⋯. */
  archive?: 'archive' | 'unarchive'
  copyId: boolean
  /** The one filled primary button. */
  primary: 'approve' | 'openPr' | 'archive' | null
}

/** `local`: a plan of this computer, not a paired Runtime's (lifecycle actions are this computer's only). */
export function headerActionsOf(row: HeaderRow | undefined, local: boolean): HeaderActions {
  if (!row) return { finished: false, approve: false, consoles: true, copyId: false, primary: null }
  const approve = approveViewOf(row).show
  // a schedule template never finishes, and a plan not started yet waits, whatever its outcome reads
  const finished = row.schedule === undefined && !row.pendingStart && (row.archivedAt !== undefined || isFinishedOutcome(row.outcome))
  if (!finished) return { finished: false, approve, consoles: true, copyId: false, primary: approve ? 'approve' : null }
  const pr = row.pr
  const openPr: HeaderActions['openPr'] = pr?.url
    ? { kind: 'pr', url: pr.url }
    : pr?.branch !== undefined
      ? { kind: 'branch', branch: pr.branch }
      : undefined
  const archive: HeaderActions['archive'] = !local ? undefined : row.archivedAt !== undefined ? 'unarchive' : 'archive'
  return {
    finished: true,
    approve: false,
    consoles: false,
    ...(openPr ? { openPr } : {}),
    ...(archive ? { archive } : {}),
    copyId: true,
    primary: openPr?.kind === 'pr' ? 'openPr' : archive ? 'archive' : null
  }
}
