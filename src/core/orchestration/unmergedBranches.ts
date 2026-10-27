// W8-G (#101): the plan branches of a project that no one has merged. A project with no remote and delivery `pr` leaves
// each plan's work on its own branch (`JobRun.pr.note` + `branch`), and the next plan's workers start from the default
// branch. The planner is told which branches those are, so it does not base Tasks on work the workers will not have.
import { git as realGit } from '../worktrees/git'
import { deliveryBranchOf } from './delivery'
import { jobInProject, projectOfJob } from './projects'
import { jobOf, type OrchState } from './state'
import type { JobRun, Project } from './types'

/** What a plan whose project has no remote says instead of a pull request: where the work is and how to merge it. */
export const noRemoteNote = (branch: string, folder: string): string =>
  `This project has no remote; the plan's work is on branch ${branch}. To merge it, run \`git merge ${branch}\` in ${folder}`

/** The branches the project's no-remote plans left their work on, oldest first (state only: no git). */
export function recordedPlanBranches(s: OrchState, project: Project): string[] {
  const out: string[] = []
  for (const run of s.runs) {
    const job = s.jobs.find((j) => j.id === run.jobId)
    if (job && run.pr?.note !== undefined && run.pr.branch && jobInProject(s, job, project) && !out.includes(run.pr.branch)) out.push(run.pr.branch)
  }
  return out
}

/** Those still unmerged: the branch exists and is not an ancestor of the default branch. A git that cannot tell drops
 *  the branch, so the planner is never told a falsehood about work it cannot find. */
export async function unmergedPlanBranches(s: OrchState, project: Project, run: typeof realGit = realGit): Promise<{ branches: string[]; into: string }> {
  const into = project.defaultBranch ?? (await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: project.path })).stdout
  const branches: string[] = []
  if (into === '') return { branches, into }
  for (const b of recordedPlanBranches(s, project)) {
    const exists = await run(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { cwd: project.path })
    if (!exists.ok) continue
    const merged = await run(['merge-base', '--is-ancestor', `refs/heads/${b}`, into], { cwd: project.path })
    if (!merged.ok && merged.stderr.trim() === '') branches.push(b) // exit 1, no message: not an ancestor
  }
  return { branches, into }
}

/** Whether git sees a Run's plan branch already in its delivery branch, as when the owner merged it by hand. The branch is
 *  the PR's, else the one the Run's folder stands on; the target is the plan's delivery branch, else the project's default
 *  branch, else the branch the project folder stands on. `null`: git cannot tell (no branch, a git error), so the Run is
 *  left as it is. The target branch itself never counts, and neither does a branch that no longer exists. */
export async function branchInDeliveryBranch(s: OrchState, runOf: JobRun, run: typeof realGit = realGit): Promise<boolean | null> {
  const job = jobOf(s, runOf)
  if (!job) return null
  const head = async (cwd: string): Promise<string | null> => {
    const r = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd })
    return r.ok && r.stdout !== '' ? r.stdout : null
  }
  const branch = runOf.pr?.branch ?? (runOf.worktree !== undefined ? await head(runOf.worktree) : null)
  const into = deliveryBranchOf(s, job) ?? projectOfJob(s, job)?.defaultBranch ?? (await head(job.cwd))
  if (!branch || !into || branch === into) return null
  if (!(await run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: job.cwd })).ok) return null
  const merged = await run(['merge-base', '--is-ancestor', `refs/heads/${branch}`, into], { cwd: job.cwd })
  if (merged.ok) return true
  return merged.stderr.trim() === '' ? false : null // exit 1, no message: not an ancestor; anything else, git failed
}
