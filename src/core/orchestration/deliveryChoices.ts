// T6: which deliveries a project can use as it is set up on this computer: a git repository can merge the plan locally,
// a remote can be pushed to, a GitHub remote with gh signed in can take a pull request, and review by the owner always
// works. The renderer offers only these; a saved delivery that does not work now shows the fallback and why.
//
// Pure and node-free: the renderer imports it (tsconfig.web.json).
import type { DeliveryMode } from './types'

/** What the main process reads off the project folder (`projects.deliverySetup`). */
export interface DeliverySetup {
  isGitRepo: boolean
  /** `origin`'s URL; null with no `origin` remote. */
  remoteUrl: string | null
  /** `gh auth status` answered signed in. */
  ghSignedIn: boolean
  /** The branch a delivery lands on when the project sets none: origin's default, else the folder's own. */
  branch: string | null
}

/** Why a delivery is off: not a git repository (nothing to merge), no remote (nothing to push to), no GitHub remote or
 *  gh not signed in (no pull request). */
export type DeliveryOffReason = 'notGit' | 'noRemote' | 'notGitHub' | 'ghSignedOut'

export interface DeliveryChoice {
  mode: DeliveryMode
  available: boolean
  reason?: DeliveryOffReason
  /** push: the remote's host (null for a path), and whether it is GitHub, for the label. */
  host?: string | null
  github?: boolean
}

/** The host of a git remote URL, lower-cased: `https://host/…`, `ssh://user@host:port/…`, `user@host:path`; null for a
 *  local path. */
export function remoteHostOf(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url) ?? /^[^@/\s]+@([^:/\s]+):/.exec(url)
  return m ? m[1].toLowerCase() : null
}

/** Every delivery in the order offered (merge, push, pull request, review), each with whether it works now. */
export function deliveryChoicesOf(setup: DeliverySetup): DeliveryChoice[] {
  const remote = setup.isGitRepo && setup.remoteUrl ? setup.remoteUrl : null
  const host = remote === null ? null : remoteHostOf(remote)
  const github = host === 'github.com'
  const off = (mode: DeliveryMode, reason: DeliveryOffReason | null, extra?: Partial<DeliveryChoice>): DeliveryChoice =>
    reason === null ? { mode, available: true, ...extra } : { mode, available: false, reason, ...extra }
  return [
    off('merge', setup.isGitRepo ? null : 'notGit'),
    !setup.isGitRepo ? off('push', 'notGit') : remote === null ? off('push', 'noRemote') : off('push', null, { host, github }),
    off('pr', !setup.isGitRepo ? 'notGit' : !github ? 'notGitHub' : setup.ghSignedIn ? null : 'ghSignedOut'),
    off('manual', null)
  ]
}

/** The delivery a project or plan really gets offered: its saved one when that works, else merge, else review (never
 *  an outward push or pull request nobody chose), with the reason the saved one is off. */
export function effectiveDelivery(saved: DeliveryMode, choices: readonly DeliveryChoice[]): { mode: DeliveryMode; reason?: DeliveryOffReason } {
  const own = choices.find((c) => c.mode === saved)
  if (own === undefined || own.available) return { mode: saved }
  const mode = choices.some((c) => c.mode === 'merge' && c.available) ? 'merge' : 'manual'
  return own.reason === undefined ? { mode } : { mode, reason: own.reason }
}
