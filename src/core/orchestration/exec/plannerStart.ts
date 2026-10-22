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
import { handsOffOf } from './plannerFeedback'
import { startChainHolding, type CoordinatorStartContext, type StartCoordinatorArgs } from './workerStart'

/** The planner's brief, named for its Job, in the spec directory beside the coordinators' briefs. The boot
 *  sweep (`staleSpecFiles`) removes it at the next start; the planner has read it by then. */
export const plannerBriefName = (jobId: string): string => `planner-${jobId}.md`

/** Starts a planner on the Job `a.runId` names (a planner has no Run yet: its Job is `pendingStart`).
 *
 *  **`bypassPermissions` is always false**, whatever the app's setting: the planner only reads and runs
 *  `astera` commands, so it never needs the bypass, and without it every file edit it attempts stops at
 *  Claude's permission prompt for the person to refuse. #117: a hands-off plan's planner bypasses, by the owner's
 *  choice on Start: a prompt there would wait on nobody. */
export async function startPlannerSession(ctx: CoordinatorStartContext, a: StartCoordinatorArgs): Promise<{ sessionId: string; accountId: string }> {
  const job = ctx.getState().jobs.find((j) => j.id === a.runId)
  // A file and one line, for the reason the coordinator's brief is (coordinatorLaunchPrompt).
  const briefPath = path.join(ctx.specsDir, plannerBriefName(a.runId))
  await fs.writeFile(briefPath, a.brief, 'utf8')
  // T2: the account and chain by usage when "Pick accounts automatically" is on (autoStartChain)
  // T5b: the named account is a preference (chooseStartAccount); `release` once the session runs
  const { accountId, chain, release } = await startChainHolding(ctx, a.accountId, {
    purpose: 'planner',
    subject: a.runId,
    gone: () => {
      const j = ctx.getState().jobs.find((x) => x.id === a.runId)
      return j === undefined || j.archivedAt !== undefined
    },
    ...(a.auto ? { auto: true } : {})
  })
  try {
    await ctx.preTrust(accountId, a.cwd)
    const account = (await ctx.accounts()).find((x) => x.id === accountId)
    let settings: RoleModelSettings = {}
    try {
      settings = await ctx.roleModels()
    } catch (e) {
      ctx.log(`role models: settings unreadable, using the built-in defaults: ${String(e)}`)
    }
    // The premium planning model (W1-A, SPEC §4): opus unless the Job or the app says otherwise.
    const model = account ? resolveRoleModel(settings, job, 'planner', providerOf(account)) : undefined
    const info = await ctx.spawn({
      accountId,
      cwd: a.cwd,
      // #117: except on a hands-off plan, where nobody is there to answer a prompt
      bypassPermissions: job !== undefined && handsOffOf(ctx.getState(), job),
      initialPrompt: coordinatorLaunchPrompt(briefPath.replace(/\\/g, '/')),
      title: `Planner · ${job ? jobNameOf(job).slice(0, 40) : a.runId.slice(0, 12)}`,
      // One account: a limit waits for its reset in the same session, keeping the plan's context. T2: with "Pick
      // accounts automatically" on, the whole order, so a limit rolls the same session on instead of waiting.
      rollAccountIds: chain,
      ...(model ? { model } : {}),
      // W7-A: the owner's feedback goes on in the same conversation, which keeps everything the planner read
      ...(a.resume ? { resumeSessionId: a.resume } : {})
    })
    ctx.log(`planner started job=${a.runId} session=${info.id} account=${accountId} model=${model ?? 'CLI default'}`)
    return { sessionId: info.id, accountId }
  } finally {
    release()
  }
}
