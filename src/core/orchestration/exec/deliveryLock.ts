// **One delivery per repository and branch at a time, end to end** (2026-11-03). A push delivery merges the plan into
// the project's own checkout, validates, runs the pre-push hook and pushes: minutes on a monorepo. Two of them in one
// checkout interleave their merges, and the second plan is judged against the first one's unpushed commits. The
// dispatch loop already delivers one plan per project per pass, but it lets go of its place when a delivery runs past
// its limit (BACKGROUND_JOB_LIMIT_MS) while that delivery is still running, and "Retry now" or a person's
// `run-deliver` never asked it. This lock is held by `deliverByPush` itself, in the one process that delivers (the
// Host), from the first look at the checkout until the push is done, so the next delivery always starts on the
// branch as the last one left it.
import path from 'node:path'
import { comparablePath } from '../../files/tree'
import { git as realGit } from '../../worktrees/git'

/** How long a delivery waits for the one before it on the same branch before it stops as `delivery-busy` (nothing
 *  touched, no attempt counted, due again in a minute, when it takes its place in line again). Under the dispatch
 *  loop's BACKGROUND_JOB_LIMIT_MS (20 minutes), so a waiting delivery answers before the loop gives up on it: a given
 *  up one would be counted as failed and tried again while it still waits, two of one Run in line. */
export const DELIVERY_LOCK_WAIT_MS = 15 * 60_000

interface Holder {
  label: string
  since: number
}

/** Per key: the end of the last delivery in line (each waits for the one before), and who holds it now. */
const tails = new Map<string, Promise<void>>()
const holders = new Map<string, Holder>()

/** The lock's key: the repository (its common git dir, so a linked worktree of it is the same repository) and the
 *  branch. A git that cannot tell falls back to the folder itself. */
export async function deliveryLockKey(cwd: string, branch: string, run: typeof realGit = realGit): Promise<string> {
  const r = await run(['rev-parse', '--git-common-dir'], { cwd })
  const dir = r.ok && r.stdout.trim() !== '' ? path.resolve(cwd, r.stdout.trim()) : cwd
  return `${comparablePath(dir)}\n${branch}`
}

/** Who holds `key` now and since when, for a waiting delivery's log line; undefined when nobody. */
export const deliveryLockHolder = (key: string): Holder | undefined => holders.get(key)

/**
 * Runs `work` once every delivery before it on `key` ended. `waitMs` bounds the wait: past it, `{ ok: false }` with the
 * holder, and `work` never runs (the place in line is given up, so the ones after wait only for the holder). `label`
 * names this delivery to the ones that wait for it. Never runs two `work`s of one key at once, also when one throws.
 */
export async function withDeliveryLock<T>(
  key: string,
  label: string,
  work: () => Promise<T>,
  o: { waitMs?: number; log?: (m: string) => void; now?: () => number } = {}
): Promise<{ ok: true; value: T } | { ok: false; holder: string; heldMs: number }> {
  const now = o.now ?? Date.now
  const before = tails.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const mine = new Promise<void>((r) => (release = r))
  const tail = before.then(() => mine)
  tails.set(key, tail)
  const holder = holders.get(key)
  if (holder !== undefined) o.log?.(`delivery: waiting for the delivery of ${holder.label} to finish first (one delivery per branch at a time)`)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = await Promise.race([
    before.then(() => false),
    new Promise<boolean>((r) => {
      timer = setTimeout(() => r(true), o.waitMs ?? DELIVERY_LOCK_WAIT_MS)
      timer.unref?.()
    })
  ])
  clearTimeout(timer)
  if (timedOut) {
    release()
    const h = holders.get(key)
    return { ok: false, holder: h?.label ?? 'another delivery', heldMs: h ? now() - h.since : 0 }
  }
  holders.set(key, { label, since: now() })
  try {
    return { ok: true, value: await work() }
  } finally {
    holders.delete(key)
    release()
    if (tails.get(key) === tail) tails.delete(key)
  }
}
