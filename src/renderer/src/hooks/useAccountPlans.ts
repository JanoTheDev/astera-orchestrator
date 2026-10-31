import { useEffect, useState } from 'react'
import type { Account, AccountPlan } from '../../../core/types'

// T4 (account center redesign): each account's subscription plan (accounts.plan, read in main from the account's own
// config folder: core/accounts/plan.ts), for the plan chip on the account rows and for the "no 5-hour window" rule
// (components/sessionWindow.ts) in the rows, the account picker and Start.
//
// Main caches the reading and drops it on a login change, so asking on mount is cheap. The answers are kept for the
// window, so a popover that mounts on open draws the chips it drew last time at once. Re-asked for an account when
// main's `accounts:status-changed` push names it (a sign-in or sign-out, which is when a plan changes); no polling.

const known: Record<string, AccountPlan> = {}

/** Plans by account id. An account is absent until its first answer; a failed ask leaves it as it was. */
export function useAccountPlans(accounts: readonly Account[]): Record<string, AccountPlan> {
  const key = accounts.map((a) => a.id).join('\n')
  const [plans, setPlans] = useState<Record<string, AccountPlan>>(() => ({ ...known }))
  useEffect(() => {
    const ids = new Set(key === '' ? [] : key.split('\n'))
    let live = true
    const ask = (id: string): void => {
      window.api.accounts.plan(id).then(
        (plan) => {
          known[id] = plan
          if (live) setPlans((cur) => ({ ...cur, [id]: plan }))
        },
        () => {}
      )
    }
    ids.forEach(ask)
    const off = window.api.on('accounts:status-changed', (p) => {
      if (ids.has(p.accountId)) ask(p.accountId)
    })
    return () => {
      live = false
      off()
    }
  }, [key])
  return plans
}
