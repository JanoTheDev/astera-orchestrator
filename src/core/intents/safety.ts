// W3-B: what a command may do on its own (CONTEXT rule 6, SPEC §8 "voice is never authorization").
//
// - `read`: looks, opens a view, or answers. Runs as soon as it is parsed, spoken or typed.
// - `act`: starts something that is cheap to undo (a planner, a line typed into a session, a resume). Runs on Enter
//   or a click in the command bar, never straight from a voice transcript.
// - `confirm`: closes sessions, deletes, merges, or spends quota on workers (approve). Runs only through a function
//   that asks first in the app's own confirmation dialog (lib/jobActions.ts); no text or speech reaches it alone.
import type { IntentKind } from './types'

export type Safety = 'read' | 'act' | 'confirm'

export const SAFETY: Record<IntentKind, Safety> = {
  reply: 'read',
  switch: 'read',
  'show-sessions': 'read',
  summarize: 'read',
  waiting: 'read',
  plan: 'act',
  send: 'act',
  resume: 'act',
  // Approving starts workers, which spends quota: the same click as a destructive command (W3-B prompt).
  approve: 'confirm',
  // W5-C: pause and stop-launching close nothing. On a plan they hold its launching (jobs-hold) and ask nothing; on a
  // worker, pause holds that worker (worker-hold), which its executor asks about first in the app's dialog.
  pause: 'act',
  'stop-launching': 'act',
  // Closes the plan's workers and coordinator (runs-stop, or run-pause for a schedule).
  stop: 'confirm',
  // W7-A: feedback starts a planner or a replan, cheap to undo; rejecting archives a plan and asks first (rejectPlan)
  'plan-feedback': 'act',
  'plan-reject': 'confirm',
  archive: 'confirm',
  delete: 'confirm',
  merge: 'confirm'
}

/** How the command reached the bar: parsed and nothing pressed yet (`auto`, which is how a voice transcript lands),
 *  or Enter / the Run button. */
export type Trigger = 'auto' | 'submit'

/** Whether the bar may start this intent now. `confirm` is never started by the bar itself: its executor asks. */
export function mayStart(kind: IntentKind, trigger: Trigger): boolean {
  const s = SAFETY[kind]
  return s === 'read' || trigger === 'submit'
}
