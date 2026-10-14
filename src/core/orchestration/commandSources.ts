// The job-source commands (plugin Phase 4 J10-J16): the sources a person can make a Job from (the job-source plugins
// and GitHub issues), a page of a source's items, one item read whole, and a Job made from an item. The Host asks the
// plugins (`deps.jobSources`) and gh (`deps.github`); what a plugin answers is checked and cut (sources/answers.ts),
// the Job's objective is the Host's own, the item's content quoted inside it as data (sources/objective.ts), and the Job
// keeps where it came from, set here alone (JOB_SOURCE).
import type { OrchServerDeps } from './command'
import { findProject } from './projects'
import type { OrchState } from './state'
import { itemDetail, itemsPage, jobContext, type SourceContext } from '../sources/answers'
import { sourcedObjective } from '../sources/objective'
import { GITHUB_SOURCE_ID, issueContext, issueDetail, listIssueItems } from '../github/issueSource'
import type { GhFailed } from '../github/gh'

type Reply = { status: number; body: unknown }
type Caller = { sessionId: string; role?: 'app' | 'cli' | 'mcp' | 'controller' | 'plugin' }
type Handle = (deps: OrchServerDeps, caller: Caller, cmd: string, args: Record<string, unknown>) => Promise<Reply>

export const SOURCE_COMMANDS: ReadonlySet<string> = new Set(['sources-list', 'sources-items', 'sources-item', 'jobs-create-from-source'])

/** The key the Host gives `jobs-create` (and `run-create`) the job source's item under (plugin Phase 4 J15). A symbol:
 *  no JSON a caller sends can hold one, so only `jobs-create-from-source`, inside this process, sets a Job's source. */
export const JOB_SOURCE: unique symbol = Symbol('job-source')

/** How the Host reaches the job-source plugins: which there are, and a question to one (the plugin runtime's request,
 *  with its time limit). `ask` rejects with an error carrying the status to answer (`status`: 502, 503 or 504). */
export interface JobSourcesDeps {
  plugins(): Promise<Array<{ id: string; displayName: string; ready: boolean; reason?: string }>>
  ask(id: string, method: 'jobSource.list' | 'jobSource.get' | 'jobSource.context', params: unknown): Promise<unknown>
}

/** What GitHub issues are called where a person picks a source. */
const GITHUB_NAME = 'GitHub issues'
/** Each folder's owner/repo, read once for a search (issueSource.ts). */
const slugs = new Map<string, string>()

const bad = (error: string): Reply => ({ status: 400, body: { error } })
const ok = (body: unknown): Reply => ({ status: 200, body })
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const ghReply = (f: GhFailed): Reply => ({
  status: f.kind === 'not-found' ? 404 : f.kind === 'not-installed' || f.kind === 'auth' ? 409 : 502,
  body: { error: f.message }
})
/** A plugin's failure as the caller hears it: its status, and a sentence naming the source. */
const askFailed = (e: unknown, name: string, what: string): Reply => {
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 502
  return { status, body: { error: `the ${name} source could not ${what}: ${e instanceof Error ? e.message : String(e)}` } }
}
/** The Jobs made from item `itemId` of source `id` (J16). */
const jobsFrom = (s: OrchState, id: string, itemId: string): string[] =>
  s.jobs.filter((j) => j.source?.id === id && j.source.itemId === itemId).map((j) => j.id)

/** A source a call names: GitHub, or a plugin the Host has. */
type Source = { kind: 'github'; name: string } | { kind: 'plugin'; id: string; name: string }

export async function sourcesCommand(deps: OrchServerDeps, caller: Caller, cmd: string, args: Record<string, unknown>, handle: Handle): Promise<Reply> {
  const plugins = async (): Promise<Array<{ id: string; displayName: string; ready: boolean; reason?: string }>> =>
    deps.jobSources ? await deps.jobSources.plugins() : []

  if (cmd === 'sources-list') {
    const github = deps.github
      ? { id: GITHUB_SOURCE_ID, displayName: GITHUB_NAME, ready: true, needsProject: true }
      : { id: GITHUB_SOURCE_ID, displayName: GITHUB_NAME, ready: false, reason: 'this Host does not answer GitHub commands', needsProject: true }
    return ok({ sources: [github, ...(await plugins()).map((p) => ({ ...p, needsProject: false }))] })
  }

  const sourceId = str(args.source)
  if (sourceId === null) return bad('--source is required: a source from sources list')
  let source: Source
  if (sourceId === GITHUB_SOURCE_ID) source = { kind: 'github', name: GITHUB_NAME }
  else {
    const plugin = (await plugins()).find((p) => p.id === sourceId)
    if (!plugin) return { status: 404, body: { error: `no job source ${sourceId}: sources list names them` } }
    source = { kind: 'plugin', id: plugin.id, name: plugin.displayName }
  }
  const s = deps.getState()
  /** The folder GitHub's commands run in: the project's. */
  const githubFolder = (): { gh: NonNullable<OrchServerDeps['github']>['run']; cwd: string } | Reply => {
    if (!deps.github) return { status: 409, body: { error: 'this Host does not answer GitHub commands' } }
    const projectId = str(args.project)
    if (projectId === null) return bad(`the ${GITHUB_NAME} source needs --project: the project whose repository it lists`)
    const project = findProject(s, projectId)
    if (!project) return { status: 404, body: { error: `unknown project: ${projectId}` } }
    return { gh: deps.github.run, cwd: project.path }
  }
  const isReply = (v: unknown): v is Reply => typeof (v as Reply).status === 'number'

  if (cmd === 'sources-items') {
    const query = str(args.query)
    const cursor = str(args.cursor)
    if (source.kind === 'github') {
      const at = githubFolder()
      if (isReply(at)) return at
      const r = await listIssueItems(at.gh, at.cwd, { ...(query ? { query } : {}), ...(cursor ? { cursor } : {}) }, slugs)
      if (!r.ok) return ghReply(r)
      return ok({ items: r.items.map((i) => ({ ...i, jobs: jobsFrom(s, GITHUB_SOURCE_ID, i.id) })), ...(r.nextCursor ? { nextCursor: r.nextCursor } : {}) })
    }
    let answer: unknown
    try {
      answer = await deps.jobSources!.ask(source.id, 'jobSource.list', { ...(query ? { query } : {}), ...(cursor ? { cursor } : {}) })
    } catch (e) {
      return askFailed(e, source.name, 'list items')
    }
    const page = itemsPage(answer)
    if (!page.ok) return { status: 502, body: { error: `the ${source.name} source answered with something that is not a page of items: ${page.problem}` } }
    return ok({
      items: page.value.items.map((i) => ({ ...i, selectable: true, jobs: jobsFrom(s, source.id, i.id) })),
      ...(page.value.nextCursor ? { nextCursor: page.value.nextCursor } : {}),
      ...(page.cut ? { cut: true } : {})
    })
  }

  const itemId = str(args.id)
  if (itemId === null) return bad('--id is required: an item from sources items')

  if (cmd === 'sources-item') {
    if (source.kind === 'github') {
      const at = githubFolder()
      if (isReply(at)) return at
      const r = await issueDetail(at.gh, at.cwd, itemId)
      if (!r.ok) return ghReply(r)
      return ok({ ...r.detail, selectable: r.selectable, ...(r.reason ? { reason: r.reason } : {}), jobs: jobsFrom(s, GITHUB_SOURCE_ID, itemId) })
    }
    let answer: unknown
    try {
      answer = await deps.jobSources!.ask(source.id, 'jobSource.get', { id: itemId })
    } catch (e) {
      return askFailed(e, source.name, `read ${itemId}`)
    }
    const detail = itemDetail(answer)
    if (!detail.ok) return { status: 502, body: { error: `the ${source.name} source answered with something that is not an item: ${detail.problem}` } }
    return ok({ ...detail.value, selectable: true, jobs: jobsFrom(s, source.id, itemId), ...(detail.cut ? { cut: true } : {}) })
  }

  // jobs-create-from-source: the objective and the folder are the item's and the project's (J10)
  if (args.objective !== undefined) return bad("--objective does not go with jobs-create-from-source: the item is the Job's objective")
  if (args.cwd !== undefined) return bad("--cwd does not go with jobs-create-from-source: the Job works in the project's folder")
  if (args.run !== undefined) return bad('--run does not go with jobs-create-from-source: give --project')
  const projectId = str(args.project)
  if (projectId === null) return bad('--project is required: the project the Job works in')
  const project = findProject(s, projectId)
  if (!project) return { status: 404, body: { error: `unknown project: ${projectId}` } }
  let ctx: SourceContext
  if (source.kind === 'github') {
    if (!deps.github) return { status: 409, body: { error: 'this Host does not answer GitHub commands' } }
    const r = await issueDetail(deps.github.run, project.path, itemId)
    if (!r.ok) return ghReply(r)
    if (!r.selectable) return { status: 403, body: { error: `#${itemId} cannot become a Job: ${r.reason ?? 'it is not one that can'}` } }
    ctx = issueContext(r.issue)
  } else {
    let answer: unknown
    try {
      answer = await deps.jobSources!.ask(source.id, 'jobSource.context', { id: itemId })
    } catch (e) {
      return askFailed(e, source.name, `build the Job of ${itemId}`)
    }
    const checked = jobContext(answer)
    if (!checked.ok) return { status: 502, body: { error: `the ${source.name} source answered with something that is not a Job's context: ${checked.problem}` } }
    ctx = checked.value
  }
  const { source: _source, id: _id, project: _project, ...rest } = args
  return createFromContext(deps, caller, handle, {
    rest,
    cwd: project.path,
    ctx,
    sourceId: source.kind === 'github' ? GITHUB_SOURCE_ID : source.id,
    sourceName: source.kind === 'github' ? 'GitHub' : source.name,
    itemId
  })
}

/** The Job of an item: through `jobs-create` with the rest of the caller's flags, in `cwd`, its objective the Host's
 *  (J14) and its source the item (J15). `jobs-create-from-issue` makes its Job here too (J13). */
export function createFromContext(
  deps: OrchServerDeps,
  caller: Caller,
  handle: Handle,
  a: { rest: Record<string, unknown>; cwd: string; ctx: SourceContext; sourceId: string; sourceName: string; itemId: string }
): Promise<Reply> {
  return handle(deps, caller, 'jobs-create', {
    ...a.rest,
    cwd: a.cwd,
    objective: sourcedObjective(a.ctx, a.sourceName),
    [JOB_SOURCE]: { id: a.sourceId, itemId: a.itemId, label: a.ctx.sourceLabel, ...(a.ctx.sourceUrl ? { url: a.ctx.sourceUrl } : {}) }
  })
}
