// Who holds a plan from launching new workers (Job.dispatchHold), read off the Job for the screens: the owner's own
// "stop launching" (`jobs-hold`) and every unscoped replan set the same flag (exec/replanStart.ts), so the flag alone
// cannot say which. Display only: placement still reads `dispatchHold` and `waveOpen`.
import type { JobHold } from '../types'
import type { Job } from './types'
import type { ReplanRecord } from './replan'

/** `replanning`: a planner is updating the plan (a wave boundary, the owner's feedback or chat); `final-check`: the
 *  completion pass before delivery; `replan-question`: a replan was handed to the owner (`lastReplan.escalated`) and the
 *  hold stays until they answer; `owner`: the owner's `jobs-hold`. Absent: nothing holds the whole plan (a scoped
 *  replan holds only the Tasks it can affect). */
export function holdOf(job: Job): JobHold | undefined {
  const r = job.replanning as ReplanRecord | undefined
  if (r && !r.scoped) return r.mode === 'completion' && r.feedbackAt === undefined && !r.chat ? 'final-check' : 'replanning'
  if (!job.dispatchHold) return undefined
  // shortcut: `escalated` stays on lastReplan until the next replan ends, so a release and a later jobs-hold still reads as
  // the question; mark the answer on the Job if that shows up
  return job.lastReplan?.escalated !== undefined ? 'replan-question' : 'owner'
}
