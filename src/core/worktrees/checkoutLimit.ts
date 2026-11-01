import { comparablePath } from '../files/tree'

/** How many new worktrees of one repository may populate their tree at once. Populating touches only the new
 *  worktree's own index and files, so it needs no repo lock; the cap only keeps the disk from thrashing. 6 because
 *  6 ready Tasks of one repository must all start within 60 s with a 40 s checkout (owner feedback item 19): with 4,
 *  the fifth and sixth wait a whole checkout and finish near 80 s. If checkouts themselves stay too slow, the next step
 *  is a warm pool of pre-made worktrees. */
export const CHECKOUT_LIMIT_PER_REPO = 6

const slots = new Map<string, { active: number; waiting: (() => void)[] }>()

/** Runs `run` once fewer than `limit` runs of the same repository are going, in arrival order; a failed run hands its
 *  slot on all the same. */
export async function inCheckoutSlot<T>(repoPath: string, run: () => Promise<T>, limit = CHECKOUT_LIMIT_PER_REPO): Promise<T> {
  const key = comparablePath(repoPath)
  let s = slots.get(key)
  if (!s) slots.set(key, (s = { active: 0, waiting: [] }))
  const slot = s
  if (slot.active >= limit) await new Promise<void>((r) => slot.waiting.push(r))
  else slot.active++
  try {
    return await run()
  } finally {
    const next = slot.waiting.shift()
    if (next) next() // the slot passes straight on, so active stays as it is
    else if (--slot.active === 0) slots.delete(key)
  }
}
