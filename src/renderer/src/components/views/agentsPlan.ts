// The Agents side bar's plan filter. A store rather than AgentsView state so a plan's "Its consoles"
// (shell/navigation.ts openPlanConsoles) can set it from outside. Per window: localStorage is the window's.
import { useSyncExternalStore } from 'react'
import { ALL_PLANS } from '../wall/wallModel'

const KEY = 'cm.agentsView.plan'
const read = (): string => {
  try {
    return localStorage.getItem(KEY) ?? ALL_PLANS
  } catch {
    return ALL_PLANS
  }
}

let plan = read()
const listeners = new Set<() => void>()

export function setAgentsPlan(next: string): void {
  if (next === plan) return
  plan = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // a window without storage keeps the filter in memory only
  }
  for (const l of [...listeners]) l()
}

export const getAgentsPlan = (): string => plan

export function useAgentsPlan(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    getAgentsPlan
  )
}
