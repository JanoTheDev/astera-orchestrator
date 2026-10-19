/** The command the "+ new job" form sends after `run-create`: queue the planner behind another plan
 *  (`jobs-set --after`, the Host starts it once that plan is delivered), start it now (`jobs-plan`), or nothing.
 *  A schedule template never plans, and an unchecked planner starts nothing, so `after` is ignored then. */
export function newRunSubmit(o: {
  id: string
  after: string
  plan: boolean
  scheduled: boolean
}): { cmd: 'jobs-set' | 'jobs-plan'; args: { id: string; after?: string } } | null {
  if (!o.plan || o.scheduled) return null
  return o.after ? { cmd: 'jobs-set', args: { id: o.id, after: o.after } } : { cmd: 'jobs-plan', args: { id: o.id } }
}
