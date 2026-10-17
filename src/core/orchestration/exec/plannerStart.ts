// W2-A planner stage (SPEC §2): the planner session's start. It takes the coordinator's spawn path whole
// (`startCoordinatorSession` hands a `role: 'planner'` start here), so the app and the Host start a planner
// with the same account wrapper, rolling registration and orchestration env as a coordinator. What differs
// is the brief, the model role, the tab title, and that a planner never runs with the permission bypass.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { providerOf } from '../../providers/meta'
import { coordinatorLaunchPrompt } from '../handover'
import { jobNameOf } from '../jobName'
import { resolveRoleModel, type RoleModelSettings } from '../roleModels'
import type { CoordinatorStartContext, StartCoordinatorArgs } from './workerStart'

/** The planner's brief, named for its Job, in the spec directory beside the coordinators' briefs. The boot
 *  sweep (`staleSpecFiles`) removes it at the next start; the planner has read it by then. */
export const plannerBriefName = (jobId: string): string => `planner-${jobId}.md`

/** Starts a planner on the Job `a.runId` names (a planner has no Run yet: its Job is `pendingStart`).
 *
 *  **`bypassPermissions` is always false**, whatever the app's setting: the planner only reads and runs
 *  `astera` commands, so it never needs the bypass, and without it every file edit it attempts stops at
 *  Claude's permission prompt for the person to refuse. */
export async function startPlannerSession(ctx: CoordinatorStartContext, a: StartCoordinatorArgs): Promise<{ sessionId: string }> {
  const job = ctx.getState().jobs.find((j) => j.id === a.runId)
  // A file and one line, for the reason the coordinator's brief is (coordinatorLaunchPrompt).
  const briefPath = path.join(ctx.specsDir, plannerBriefName(a.runId))
  await fs.writeFile(briefPath, a.brief, 'utf8')
  await ctx.preTrust(a.accountId, a.cwd)
  const account = (await ctx.accounts()).find((x) => x.id === a.accountId)
  let settings: RoleModelSettings = {}
  try {
    settings = await ctx.roleModels()
  } catch (e) {
    ctx.log(`role models: settings unreadable, using the built-in defaults: ${String(e)}`)
  }
  // The premium planning model (W1-A, SPEC §4): opus unless the Job or the app says otherwise.
  const model = account ? resolveRoleModel(settings, job, 'planner', providerOf(account)) : undefined
  const info = await ctx.spawn({
    accountId: a.accountId,
    cwd: a.cwd,
    bypassPermissions: false,
    initialPrompt: coordinatorLaunchPrompt(briefPath.replace(/\\/g, '/')),
    title: `Planner · ${job ? jobNameOf(job).slice(0, 40) : a.runId.slice(0, 12)}`,
    // One account: a limit waits for its reset in the same session, keeping the plan's context.
    rollAccountIds: [a.accountId],
    ...(model ? { model } : {})
  })
  ctx.log(`planner started job=${a.runId} session=${info.id} account=${a.accountId} model=${model ?? 'CLI default'}`)
  return { sessionId: info.id }
}
