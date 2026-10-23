// The Agents side bar's plan filter. A store rather than AgentsView state so a plan's "Its consoles"
// (shell/navigation.ts openPlanConsoles) can set it from outside. Per window: localStorage is the window's.
// The filter holds the id as asked (a Job id, or a plan's Run id from the plan page); it resolves to the Job id
// against the plans the workspace knows (AgentsPage publishes them), so a Run id is read the same once they load.
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

export interface PlanRef {
  jobId: string
  runId?: string
  name: string
}

/** The Job id of the plan an id names: a Run id maps to its Job; a Job id, or an id no plan has, stays as given. */
export function planJobIdOf(asked: string, plans: readonly PlanRef[]): string {
  return plans.find((x) => x.jobId === asked || x.runId === asked)?.jobId ?? asked
}

let asked = read()
let plans: readonly PlanRef[] = []
const listeners = new Set<() => void>()
const notify = (): void => {
  for (const l of [...listeners]) l()
}

export function setAgentsPlan(next: string): void {
  if (next === asked) return
  asked = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // a window without storage keeps the filter in memory only
  }
  notify()
}

export function setAgentsPlanRefs(next: readonly PlanRef[]): void {
  const same = next.length === plans.length && next.every((x, i) => x.jobId === plans[i].jobId && x.runId === plans[i].runId && x.name === plans[i].name)
  if (same) return
  plans = next
  notify()
}

export const getAgentsPlan = (): string => planJobIdOf(asked, plans)
const getPlanRefs = (): readonly PlanRef[] => plans

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useAgentsPlan(): string {
  return useSyncExternalStore(subscribe, getAgentsPlan)
}

export function useAgentsPlanRefs(): readonly PlanRef[] {
  return useSyncExternalStore(subscribe, getPlanRefs)
}
