// W2-D: a Task's GitHub links (SPEC §7): its issue, branch, commits and pull requests, and the plan's one pull request.
// GitHub stays the tracker. The repository's own CLAUDE.md workflow creates issues and adds them to Projects; Astera
// links what is there and never makes a second one. Creating is only for a repository with no such workflow, and only
// when a person asks (`task-link-issue --create`). Pure over an injected GhRunner and git runner, so tests never need
// a real gh.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ghFailureSentence, type GhFailed, type GhRunner } from './gh'
import { readIssue } from './issue'
import { git, type GitResult } from '../worktrees/git'
import type { TaskLinks } from '../orchestration/types'
import type { OrchState } from '../orchestration/state'

/** The line Astera puts in the body of an issue it creates for a Task, and searches for before it creates one. */
export const taskMarker = (taskId: string): string => `astera-task:${taskId}`

/** One row of `gh issue list --json number,title,url,body,state`. */
export interface IssueRow {
  number: number
  title: string
  url: string
  body: string
  state: string
}

const ISSUE_FIELDS = 'number,title,url,body,state'

/** The rows of `gh issue list --json …`, malformed ones left out; null when the output is not a JSON list. */
export function parseIssueRows(stdout: string): IssueRow[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  return raw.flatMap((r) => {
    const o = r as Record<string, unknown> | null
    if (!o || typeof o.number !== 'number' || typeof o.title !== 'string' || typeof o.url !== 'string') return []
    return [{ number: o.number, title: o.title, url: o.url, body: typeof o.body === 'string' ? o.body : '', state: String(o.state ?? '') }]
  })
}

const sameTitle = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The issue that is already this Task's: one whose body carries its marker, else one with the same title. Open ones
 *  first, since a closed duplicate is history, not the place to track new work. Null when none is. */
export function pickExistingIssue(rows: readonly IssueRow[], want: { title: string; taskId: string }): IssueRow | null {
  const marker = taskMarker(want.taskId)
  const hits = rows.filter((r) => r.body.includes(marker) || sameTitle(r.title, want.title))
  return hits.find((r) => r.state.toUpperCase() === 'OPEN') ?? hits[0] ?? null
}

/** Looks for an issue this Task already has, by its marker in a body and by its title (`gh issue list --search`), open
 *  and closed. Two searches because GitHub's search ORs nothing across `in:` qualifiers. */
export async function findExistingIssue(
  gh: GhRunner,
  cwd: string,
  want: { title: string; taskId: string }
): Promise<{ ok: true; issue: IssueRow | null } | GhFailed> {
  const quoted = want.title.replace(/"/g, ' ').trim()
  const searches = [`"${taskMarker(want.taskId)}" in:body`, ...(quoted !== '' ? [`"${quoted}" in:title`] : [])]
  const rows: IssueRow[] = []
  for (const q of searches) {
    const r = await gh(['issue', 'list', '--state', 'all', '--limit', '30', '--search', q, '--json', ISSUE_FIELDS], cwd)
    if (!r.ok) return { ok: false, ...ghFailureSentence(r) }
    const parsed = parseIssueRows(r.stdout)
    if (parsed === null) return { ok: false, kind: 'other', message: 'gh issue list answered with something that is not JSON' }
    rows.push(...parsed)
    const hit = pickExistingIssue(rows, want)
    if (hit) return { ok: true, issue: hit }
  }
  return { ok: true, issue: null }
}

/** Issue `n` as a link: it must be an issue of the repository at `cwd`, not a pull request. */
export async function issueLink(gh: GhRunner, cwd: string, n: number): Promise<{ ok: true; issue: { number: number; url: string } } | GhFailed> {
  const read = await readIssue(gh, cwd, n)
  if (!read.ok) return read
  if (read.issue.isPullRequest) return { ok: false, kind: 'not-found', message: `#${n} is a pull request, not an issue` }
  return { ok: true, issue: { number: read.issue.number, url: read.issue.url } }
}

/** The files that carry a repository's instructions to Claude. */
const INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')]
/** Words that say the instructions handle issues themselves: `gh issue …`, GitHub issues or Projects, "create an issue". */
const ISSUE_WORKFLOW = /\bgh\s+issue\b|\bgithub\s+(issues?|projects?)\b|\b(create|open|file)\s+(an?\s+|the\s+)?issues?\b/i

/** Whether the repository's CLAUDE.md files say how issues are made. **When they do, that workflow owns issues** and
 *  Astera never creates one. A file that cannot be read counts as absent. */
export async function hasIssueWorkflow(repoPath: string, read: (p: string) => Promise<string> = (p) => readFile(p, 'utf8')): Promise<boolean> {
  for (const f of INSTRUCTION_FILES) {
    const text = await read(path.join(repoPath, f)).catch(() => '')
    if (ISSUE_WORKFLOW.test(text)) return true
  }
  return false
}

/** Creates the Task's issue (`gh issue create`), its marker in the body so the next lookup finds it. Only for a
 *  repository with no issue workflow, when a person asked: the caller checks both. */
export async function createTaskIssue(
  gh: GhRunner,
  cwd: string,
  a: { title: string; body: string; taskId: string }
): Promise<{ ok: true; issue: { number: number; url: string } } | GhFailed> {
  const body = `${a.body.trim()}\n\n<!-- ${taskMarker(a.taskId)} -->`.trim()
  const r = await gh(['issue', 'create', '--title', a.title, '--body', body], cwd)
  if (!r.ok) return { ok: false, ...ghFailureSentence(r) }
  const url = r.stdout.split('\n').map((l) => l.trim()).find((l) => /^https?:\/\/\S+\/issues\/\d+$/.test(l))
  const n = url ? Number(url.slice(url.lastIndexOf('/') + 1)) : NaN
  if (!url || !Number.isInteger(n)) return { ok: false, kind: 'other', message: 'gh issue create did not answer with an issue URL' }
  return { ok: true, issue: { number: n, url } }
}

/** How many commits a Task's links keep: a Task is a few commits; a range this long is a base that went wrong. */
export const COMMITS_KEPT = 100

/** The commits `base..head` adds in `cwd`, oldest first (`git rev-list`); empty when git cannot say. */
export async function rangeCommits(
  cwd: string,
  base: string,
  head = 'HEAD',
  runGit: (args: string[], cwd: string) => Promise<GitResult> = (a, c) => git(a, { cwd: c })
): Promise<string[]> {
  const r = await runGit(['rev-list', '--reverse', `--max-count=${COMMITS_KEPT}`, `${base}..${head}`], cwd)
  return r.ok ? r.stdout.split('\n').map((l) => l.trim()).filter((l) => /^[0-9a-f]{7,64}$/.test(l)) : []
}

/** The repository's default branch (`gh repo view`), or null when gh cannot say. */
export async function defaultBranchOf(gh: GhRunner, cwd: string): Promise<string | null> {
  const r = await gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'], cwd)
  const name = r.ok ? r.stdout.trim() : ''
  return name !== '' && !/\s/.test(name) ? name : null
}

/** `links` with `patch` laid over it: the issue and branch replaced when given, pull requests by number and commits
 *  unioned, in the order first seen. */
export function mergeLinks(links: TaskLinks | undefined, patch: TaskLinks): TaskLinks {
  const out: TaskLinks = { ...links }
  if (patch.issue) out.issue = patch.issue
  if (patch.branch) out.branch = patch.branch
  if (patch.prs && patch.prs.length > 0) {
    const prs = [...(links?.prs ?? [])]
    for (const p of patch.prs) {
      const i = prs.findIndex((x) => x.number === p.number)
      if (i >= 0) prs[i] = p
      else prs.push(p)
    }
    out.prs = prs
  }
  if (patch.commits && patch.commits.length > 0)
    out.commits = [...new Set([...(links?.commits ?? []), ...patch.commits])].slice(-COMMITS_KEPT)
  return out
}

/** The number at the end of a pull request URL, or null. */
export const prNumberOf = (url: string): number | null => {
  const m = url.match(/\/pull\/(\d+)\b/)
  return m ? Number(m[1]) : null
}

/** One Task as the plan's pull request lists it. */
export interface PlanPrTask {
  title: string
  status: string
  acceptanceCriteria?: string[]
  issue?: { number: number; url: string; closes?: boolean }
  model?: string
  account?: string
  commits?: string[]
}

/** The body of a plan's one pull request: every Task, its acceptance criteria, its issue, and the model and account
 *  that did it. "Closes #n" only for an issue the repository's workflow created for this plan (`closes`); an issue
 *  that was already there is referenced, so merging does not close someone else's tracking. */
export function planPrBody(a: { plan: string; tasks: readonly PlanPrTask[] }): string {
  const lines = [`Plan: ${a.plan}`, '', '## Tasks', '']
  for (const t of a.tasks) {
    lines.push(`### ${t.title}`, '')
    const who = [t.model && `model \`${t.model}\``, t.account && `account \`${t.account}\``].filter(Boolean).join(', ')
    lines.push(`- Status: ${t.status}${who ? ` (${who})` : ''}`)
    if (t.issue) lines.push(`- Issue: ${t.issue.closes ? 'Closes' : 'Refs'} #${t.issue.number}`)
    if (t.commits && t.commits.length > 0) lines.push(`- Commits: ${t.commits.map((c) => c.slice(0, 10)).join(', ')}`)
    if (t.acceptanceCriteria && t.acceptanceCriteria.length > 0) {
      lines.push('- Acceptance criteria:')
      for (const c of t.acceptanceCriteria) lines.push(`  - ${c}`)
    }
    lines.push('')
  }
  lines.push('Opened by Astera when every task of the plan was done. It is never merged automatically.')
  return lines.join('\n')
}

/** A Task's acceptance criteria when the planner gave it some (W2-A's `Task.acceptanceCriteria`), read by shape so this
 *  file does not wait on that field. */
const acceptanceOf = (task: object): string[] | undefined => {
  const v = (task as { acceptanceCriteria?: unknown }).acceptanceCriteria
  return Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length > 0 ? v : undefined
}

/** The Tasks of `runId` as the plan's pull request lists them: the model and account of each Task's last working
 *  attempt (a review attempt is not the one that did the work), named by `accountLabel` when it knows the id. */
export function planPrTasksOf(s: OrchState, runId: string, accountLabel: (id: string) => string | undefined = () => undefined): PlanPrTask[] {
  return s.tasks
    .filter((t) => t.runId === runId)
    .map((t) => {
      const worked = s.dispatches.filter((d) => d.taskId === t.id && !d.review)
      const last = worked[worked.length - 1]
      const criteria = acceptanceOf(t)
      return {
        title: t.title,
        status: t.status,
        ...(criteria ? { acceptanceCriteria: criteria } : {}),
        ...(t.links?.issue ? { issue: t.links.issue } : {}),
        ...(t.links?.commits ? { commits: t.links.commits } : {}),
        ...(last?.model ? { model: last.model } : {}),
        ...(last ? { account: accountLabel(last.accountId) ?? last.accountId } : {})
      }
    })
}
