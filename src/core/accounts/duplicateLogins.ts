// Two registered accounts can be the same login: two config folders signed in as one email (a label "me@x.com" and
// another "me", say). Settings > Accounts detects them and offers a merge into one.
import type { Account } from '../types'
import { providerOf } from '../providers/meta'
import type { OrchState } from '../orchestration/state'

/** The accounts of one login: `keepId` stays, `dropIds` fold into it. */
export interface DuplicateGroup {
  keepId: string
  dropIds: string[]
}

const normEmail = (email: string | null | undefined): string => (email ?? '').trim().toLowerCase()

/** Whether two accounts are the same login: one provider and one non-empty email (case and surrounding spaces ignored). */
export function sameLogin(
  a: Pick<Account, 'provider'>,
  emailA: string | null | undefined,
  b: Pick<Account, 'provider'>,
  emailB: string | null | undefined
): boolean {
  const e = normEmail(emailA)
  return e !== '' && providerOf(a) === providerOf(b) && e === normEmail(emailB)
}

/**
 * Groups of two or more accounts of one provider signed in as the same email. Which one stays: the logged-in
 * one, and on a tie the earliest registered (createdAt is ISO 8601 UTC, so a string compare is chronological;
 * equal stamps keep list order, which is registration order).
 */
export function duplicateLoginGroups(
  accounts: readonly Account[],
  emailOf: (id: string) => string | null | undefined,
  loggedInIds: ReadonlySet<string>
): DuplicateGroup[] {
  const byLogin = new Map<string, Account[]>()
  for (const a of accounts) {
    const email = normEmail(emailOf(a.id))
    if (email === '') continue
    const key = `${providerOf(a)}\n${email}`
    byLogin.set(key, [...(byLogin.get(key) ?? []), a])
  }
  const groups: DuplicateGroup[] = []
  for (const members of byLogin.values()) {
    if (members.length < 2) continue
    let keep = members[0]
    for (const m of members) {
      const better = loggedInIds.has(m.id) === loggedInIds.has(keep.id) ? m.createdAt < keep.createdAt : loggedInIds.has(m.id)
      if (better) keep = m
    }
    groups.push({ keepId: keep.id, dropIds: members.filter((m) => m !== keep).map((m) => m.id) })
  }
  return groups
}

/**
 * The orchestration state with every reference to `dropId` moved to `keepId`: a Task's account chain (a chain that
 * holds both keeps the first place and loses the repeat), a Job's coordinator, planner and preferred account, and a
 * Dispatch's account. `changed` counts the rows touched; with none, `state` is the one passed in.
 */
export function rewriteAccountRefs(
  state: OrchState,
  keepId: string,
  dropId: string
): { state: OrchState; changed: number } {
  let changed = 0
  const move = (id: string | undefined): string | undefined => (id === dropId ? keepId : id)

  const tasks = state.tasks.map((t) => {
    if (!t.accountIds?.includes(dropId)) return t
    changed++
    return { ...t, accountIds: [...new Set(t.accountIds.map((id) => move(id) as string))] }
  })
  const jobs = state.jobs.map((j) => {
    if (j.coordinatorAccountId !== dropId && j.plannerAccountId !== dropId && j.preferredAccountId !== dropId) return j
    changed++
    return {
      ...j,
      ...(j.coordinatorAccountId === dropId ? { coordinatorAccountId: keepId } : {}),
      ...(j.plannerAccountId === dropId ? { plannerAccountId: keepId } : {}),
      ...(j.preferredAccountId === dropId ? { preferredAccountId: keepId } : {})
    }
  })
  const dispatches = state.dispatches.map((d) => {
    if (d.accountId !== dropId) return d
    changed++
    return { ...d, accountId: keepId }
  })
  return changed === 0 ? { state, changed } : { state: { ...state, tasks, jobs, dispatches }, changed }
}
