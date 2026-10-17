// A plan's lifecycle beyond running (orchestrator SPEC §12, W1-C): its title, and archiving it.
//
// **Archiving hides a plan and starts nothing new for it; it ends nothing.** Its open workers and its coordinator keep
// running unless the person asks `jobs archive --kill-sessions`, which stops each running Run the way `runs stop`
// does (command.ts). Every place that would start new work asks `isJobActive`: the app's placement (`appDriven`), the
// recovery and review gate (`runGatedForTask`), the schedule's fires (`firesDue`) and the commands below
// (`archivedTargetOf`). Unarchiving clears the field and nothing else: a Run that `--kill-sessions` paused stays paused
// until `runs resume`.
import type { Job } from './types'
import type { OrchState, Res } from './state'

/** A title longer than this is cut: the same bound as a source's title (JobSourceRef.title). */
export const JOB_TITLE_MAX = 300

/** Whether a plan takes new work: not archived. Pause and the start gate are their own fields, asked where they are. */
export const isJobActive = (job: Pick<Job, 'archivedAt'>): boolean => job.archivedAt === undefined

const withJob = (s: OrchState, jobId: string, next: (job: Job) => Job): Res<Job> => {
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job) return { ok: false, error: `unknown job: ${jobId}`, missing: true }
  const changed = next(job)
  return { ok: true, state: { ...s, jobs: s.jobs.map((j) => (j.id === jobId ? changed : j)) }, value: changed }
}

/** Names a plan. The title is one line; an empty one drops the field, and the plan is named by its objective again
 *  (jobNameOf). */
export function renameJob(s: OrchState, jobId: string, title: string): Res<Job> {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, JOB_TITLE_MAX)
  return withJob(s, jobId, (job) => {
    const { title: _old, ...rest } = job
    return clean === '' ? rest : { ...rest, title: clean }
  })
}

/** Archives a plan. Archiving one already archived keeps its first time. */
export function archiveJob(s: OrchState, jobId: string, now: string): Res<Job> {
  return withJob(s, jobId, (job) => (job.archivedAt !== undefined ? job : { ...job, archivedAt: now }))
}

/** Brings a plan back. The field is dropped, not set false: absent fields are this file's convention. */
export function unarchiveJob(s: OrchState, jobId: string): Res<Job> {
  return withJob(s, jobId, (job) => {
    const { archivedAt: _drop, ...rest } = job
    return rest
  })
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

/** The archived plan a command would start new work for, or undefined. The commands that start a Run, a coordinator
 *  or a worker, each read by the argument it names its target with: `jobs-run` a Job, `run-start` and `run-spawn` a
 *  Job or a Run, `tasks-dispatch` and `worker-start` a Task. */
export function archivedTargetOf(s: OrchState, cmd: string, args: Record<string, unknown>): Job | undefined {
  const jobOfRun = (runId: string | undefined): Job | undefined => {
    const run = runId === undefined ? undefined : s.runs.find((r) => r.id === runId)
    return run && s.jobs.find((j) => j.id === run.jobId)
  }
  let job: Job | undefined
  if (cmd === 'jobs-run') job = s.jobs.find((j) => j.id === str(args.id))
  else if (cmd === 'run-start' || cmd === 'run-spawn') {
    const id = str(args.run)
    job = s.jobs.find((j) => j.id === id) ?? jobOfRun(id)
  } else if (cmd === 'tasks-dispatch' || cmd === 'worker-start') {
    const taskId = cmd === 'tasks-dispatch' ? str(args.id) : (str(args.taskId) ?? str(args.task))
    job = jobOfRun(s.tasks.find((t) => t.id === taskId)?.runId)
  }
  return job && !isJobActive(job) ? job : undefined
}
