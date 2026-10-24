// "Ask about this task": the brief a chat session starts from, and the click that makes the session. The brief is built
// from what the Host already answers (a Task's full record, its changed files); the session is a real CLI chat, never a
// custom UI (DESIGN-W13 §15).
import type { OrchDoor } from '../../lib/orchDoor'
import { changesView } from '../../lib/changesView'
import { jobName } from '../../lib/jobName'
import { loadTaskInfo } from './taskEdit'

/** The brief keeps the worker's report to this many characters, and the file list to this many files. */
export const BRIEF_REPORT_MAX = 6_000
export const BRIEF_FILES_MAX = 60

export interface BriefTask {
  title: string
  spec?: string
  acceptanceCriteria?: readonly string[]
  result?: string
  gaps?: string
  reviewIssues?: ReadonlyArray<{ severity: string; title: string; file?: string; line?: number }>
  links?: { branch?: string; commits?: readonly string[] }
}
export interface BriefFile {
  path: string
  status: string
  additions?: number
  deletions?: number
  binary?: boolean
}

/** The Task's commits as a git range, oldest first: `first^..last`. */
export function rangeOf(commits: readonly string[] | undefined): string | undefined {
  return commits && commits.length > 0 ? `${commits[0]}^..${commits[commits.length - 1]}` : undefined
}

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}\n… (report cut: ${text.length - max} more characters)`)

export function briefOf({ plan, task, changes }: { plan: string; task: BriefTask; changes: { total: number; files: readonly BriefFile[] } | null }): string {
  const range = rangeOf(task.links?.commits)
  const out: string[] = [`Plan: ${plan}`, `Task: ${task.title}`]
  const part = (head: string, body: string | undefined): void => {
    if (body) out.push('', `${head}:`, body)
  }
  part('Spec', task.spec)
  part('Acceptance criteria', task.acceptanceCriteria?.map((c) => `- ${c}`).join('\n'))
  part("Worker's report", task.result && cut(task.result, BRIEF_REPORT_MAX))
  part('Gaps', task.gaps)
  part(
    'Review issues',
    task.reviewIssues?.map((i) => `- [${i.severity}] ${i.title}${i.file ? ` (${i.file}${i.line !== undefined ? `:${i.line}` : ''})` : ''}`).join('\n')
  )
  if (task.links?.branch) out.push('', `Branch: ${task.links.branch}`)
  if (range) out.push(`Commits: ${task.links!.commits!.join(', ')}`, `Git range: ${range}`)
  if (changes && changes.files.length > 0) {
    const shown = changes.files.slice(0, BRIEF_FILES_MAX)
    const list = shown.map((f) => `- ${f.path} (${f.status}${f.binary ? ', binary' : f.additions !== undefined || f.deletions !== undefined ? `, +${f.additions ?? 0} −${f.deletions ?? 0}` : ''})`)
    if (changes.total > shown.length) list.push(`… ${changes.total - shown.length} more files not listed`)
    part('Changed files', list.join('\n'))
  }
  out.push(
    '',
    `You are answering questions about this finished task. Read the code and git history (\`git show\`, \`git diff ${range ?? '<range>'}\`) to answer. Do not change files unless the person asks you to.`
  )
  return out.join('\n')
}

const errorOf = (r: { status: number; body: unknown }): string => String((r.body as { error?: unknown } | null)?.error ?? r.status)

/** Reads the plan, the Task and its changed files, then starts a chat session with the brief in the plan's repository
 *  root and hands its id to `open`. A changed-files list that cannot be read only leaves that section out. */
export async function askAboutTask(
  door: Pick<OrchDoor, 'command'>,
  runId: string,
  taskId: string,
  open: (sessionId: string) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const job = await door.command('jobs-get', { id: runId })
    const cwd = (job.body as { cwd?: unknown } | null)?.cwd
    if (job.status >= 400 || typeof cwd !== 'string') return { ok: false, error: errorOf(job) }
    const [info, changed] = await Promise.all([loadTaskInfo(door, taskId), door.command('runs-changed-files', { runId, taskId }).catch(() => null)])
    if (info === null) return { ok: false, error: taskId }
    const view = changed && changesView(changed)
    const git = view && view.kind === 'ok' ? view.reply.git : null
    const prompt = briefOf({ plan: jobName(job.body as { objective: string }), task: info.task, changes: git })
    const made = await door.command('sessions-create', { kind: 'chat', cwd, title: `Ask: ${info.task.title}`, prompt })
    const id = (made.body as { id?: unknown } | null)?.id
    if (made.status >= 400 || typeof id !== 'string') return { ok: false, error: errorOf(made) }
    open(id)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
