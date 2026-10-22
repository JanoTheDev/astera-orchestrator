// Updating a pull request Astera already opened: a plan's draft PR body after each wave, its final body, and marking
// it ready. `gh pr edit` runs a GraphQL query that touches classic projects, which GitHub now refuses ("GraphQL:
// Projects (classic) is being deprecated"), so the body always goes over REST. REST cannot clear draft, so `gh pr
// ready` stays, and only when it hits that same refusal does the markPullRequestReadyForReview mutation run alone.
import type { GhResult, GhRunner } from './gh'

/** `repos/<owner>/<repo>/pulls/<number>` from a pull request's URL, or null when the URL is not one. */
export function pullPathOf(url: string): string | null {
  const m = url.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  return m ? `repos/${m[1]}/pulls/${m[2]}` : null
}

/** The argv that sets a pull request's body over REST. `-f` (a raw string), never `-F`, which reads a value
 *  starting with `@` as a file. Null when `url` is not a pull request's URL. */
export function prBodyArgs(url: string, body: string): string[] | null {
  const path = pullPathOf(url)
  return path === null ? null : ['api', '-X', 'PATCH', path, '-f', `body=${body}`]
}

/** GitHub's refusal of a GraphQL query that touches classic projects. */
export const CLASSIC_PROJECTS = /Projects \(classic\) is being deprecated/i

export const READY_MUTATION =
  'mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }'

/** Sets the body of the pull request at `url`. */
export function setPrBody(run: GhRunner, url: string, body: string, cwd: string): Promise<GhResult> {
  const args = prBodyArgs(url, body)
  return args === null ? Promise.resolve({ ok: false, stdout: '', stderr: `not a pull request URL: ${url}` }) : run(args, cwd)
}

/** Marks the draft pull request at `url` ready for review: `gh pr ready`, or the mutation alone when that is
 *  refused for classic projects. */
export async function markPrReady(run: GhRunner, url: string, cwd: string): Promise<GhResult> {
  const ready = await run(['pr', 'ready', url], cwd)
  const path = pullPathOf(url)
  if (ready.ok || !CLASSIC_PROJECTS.test(ready.stderr) || path === null) return ready
  const node = await run(['api', path, '--jq', '.node_id'], cwd)
  if (!node.ok) return node
  return run(['api', 'graphql', '-f', `query=${READY_MUTATION}`, '-f', `id=${node.stdout.trim()}`], cwd)
}

/** T1: where a pull request stands on GitHub. A merged or closed one is the end of its plan's delivery: nothing is
 *  marked ready, pushed or retried on it. */
export type PrLanding = 'OPEN' | 'MERGED' | 'CLOSED'

/** The state of the pull request at `url` (`gh pr view --json`), or null when gh cannot tell: the caller goes on as
 *  before, since a guess either way would stop a delivery or retry a finished one. */
export async function prStateOf(run: GhRunner, url: string, cwd: string): Promise<PrLanding | null> {
  const r = await run(['pr', 'view', url, '--json', 'state,mergedAt,closedAt'], cwd)
  if (!r.ok) return null
  try {
    const state = (JSON.parse(r.stdout) as { state?: unknown }).state
    return state === 'OPEN' || state === 'MERGED' || state === 'CLOSED' ? state : null
  } catch {
    return null
  }
}
