// The approval setting's global default, last in the order plan, project, global default (plannerFeedback.ts
// `approvalOf`). From app-settings.json, narrowed the same way by the app's store and the Host's read
// (host/activity.ts `readApprovalDefault`). Node-free: the settings page imports it.

import type { Job } from '../orchestration/types'

/** `ask`: the owner approves by hand. `start`: the plan starts once it holds. `hands-off`: it starts once it holds and
 *  the coordinator decides for the owner. */
export type ApprovalMode = 'ask' | 'start' | 'hands-off'
export const APPROVAL_MODES: readonly ApprovalMode[] = ['ask', 'start', 'hands-off']

/** A mode, or undefined (no global default: the planning mode decides). Anything else the user-editable file holds is
 *  no default. */
export const approvalDefaultOf = (value: unknown): ApprovalMode | undefined => APPROVAL_MODES.find((m) => m === value)

/** What a plan with no approval setting of its own or its project's gets: the app's global default, else by the
 *  planning mode: `auto` starts when the plan holds, `chat` (or none) asks. */
export const approvalFallbackOf = (job: Pick<Job, 'planning'>, globalDefault?: ApprovalMode): ApprovalMode =>
  globalDefault ?? (job.planning === 'auto' ? 'start' : 'ask')
