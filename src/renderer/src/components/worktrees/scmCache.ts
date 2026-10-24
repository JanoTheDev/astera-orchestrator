// What the Source Control view keeps between mounts so it draws its last data at once: the key of the shared read
// cache for the overview, the push states by repo (merged as each repo answers), and the parallel query behind them.
import type { BranchPushState, WorktreeListItem } from '../../../../core/types'

export const SCM_OVERVIEW_KEY = 'scm:overview'

/** repo path -> base ref -> branch -> state. */
export type PushStates = Record<string, Record<string, Record<string, BranchPushState>>>

/** The base refs to ask about, per repo. */
export function basesByRepo(list: readonly WorktreeListItem[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>()
  for (const w of list) out.set(w.repoPath, (out.get(w.repoPath) ?? new Set()).add(w.baseRef))
  return new Map([...out].map(([repo, bases]) => [repo, [...bases]]))
}

/** One repo's answer applied; the other repos keep what they had. */
export function mergePushState(prev: PushStates, repo: string, answer: PushStates[string]): PushStates {
  return { ...prev, [repo]: answer }
}

let pushCache: PushStates = {}
export const cachedPushStates = (): PushStates => pushCache

/** Asks every repo at once and hands each answer to `onUpdate` (the merged whole) as it arrives, so one slow repo
 *  holds back no other. A repo that fails keeps its last state. */
export async function queryPushStates(
  list: readonly WorktreeListItem[],
  query: (repo: string, bases: string[]) => Promise<PushStates[string]>,
  onUpdate: (all: PushStates) => void
): Promise<void> {
  await Promise.all(
    [...basesByRepo(list)].map(async ([repo, bases]) => {
      try {
        const answer = await query(repo, bases) // read pushCache after the await: another repo may have merged meanwhile
        pushCache = mergePushState(pushCache, repo, answer)
        onUpdate(pushCache)
      } catch {
        // push state is a badge, not the list: the old one stays
      }
    })
  )
}
