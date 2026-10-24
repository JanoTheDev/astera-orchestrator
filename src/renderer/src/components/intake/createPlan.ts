import { formFailure, type OrchDoor } from '../../lib/orchDoor'
import { discardMadeJob } from '../../lib/jobActions'
import { fileUnderArgs } from './intakeRequest'

type T = (key: string, params?: Record<string, string | number>) => string

export type CreatedPlan = { ok: true; id: string; sessionId?: string } | { ok: false; error: string }

/** jobs-create, then the move under a picked sub-project, then the planner (or `jobs-set --after` to queue behind another
 *  plan). All or nothing: when a step after jobs-create fails the Job just made is deleted again, so no draft is left
 *  behind. A Job made with a `schedule` has no planner step and stays. A planner that waits for an account answers 2xx
 *  and is a started plan. */
export async function createPlan(
  door: OrchDoor,
  o: { cmd: string; args: Record<string, unknown>; projectId: string; after: string; scheduled: boolean; t: T }
): Promise<CreatedPlan> {
  const { t } = o
  const reply = await door.command(o.cmd, o.args)
  if (reply.status >= 400) return { ok: false, error: formFailure(reply, t, 'jobs.new.failed').message }
  const made = reply.body as { id?: string; projectId?: string }
  const id = made.id
  if (id === undefined) return { ok: false, error: t('jobs.new.failed') }
  const rollback = async (error: string): Promise<CreatedPlan> => {
    if (!o.scheduled) await discardMadeJob(door, id)
    return { ok: false, error }
  }
  const fileUnder = fileUnderArgs({ id, projectId: made.projectId }, o.projectId)
  if (fileUnder) {
    const moved = await door.command('jobs-set', fileUnder)
    if (moved.status >= 400) return rollback(formFailure(moved, t, 'jobs.new.failed').message)
  }
  if (o.scheduled) return { ok: true, id }
  const planned = await door.command(o.after ? 'jobs-set' : 'jobs-plan', o.after ? { id, after: o.after } : { id })
  if (planned.status < 400) {
    const sessionId = (planned.body as { sessionId?: unknown } | null)?.sessionId
    return typeof sessionId === 'string' ? { ok: true, id, sessionId } : { ok: true, id }
  }
  const why = (planned.body as { error?: unknown } | null)?.error
  return rollback(`${t('jobs.new.plannerFailed')}${typeof why === 'string' ? `: ${why}` : ''}`)
}
