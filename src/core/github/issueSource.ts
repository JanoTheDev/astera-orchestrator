// GitHub issues as a job source (plugin Phase 4 J3, J12): built into the Host, answering as a job-source plugin does.
// Per project: the open issues of the repository the project folder's remote names, read with the person's gh. An issue
// a non-member wrote is listed but cannot be picked, as `jobs-create-from-issue` has always refused it. Pure over an
// injected GhRunner.
import { ghFailureSentence, type GhFailed, type GhRunner } from './gh'
import { ISSUE_JOB_ASSOCIATIONS, issueFrom, readIssue, repoOf, type GhIssue } from './issue'
import { itemDetail, jobContext, type SourceContext, type SourceDetail, type SourceItem } from '../sources/answers'

/** The source id GitHub issues answer under, beside the plugins' ids (which are npm names, never this). */
export const GITHUB_SOURCE_ID = 'github'
/** Issues a page: GitHub's own default. */
export const GITHUB_PAGE = 30

/** An issue as an item a person may or may not pick. */
export type IssueItem = SourceItem & { selectable: boolean; reason?: string }

/** The search qualifiers that would leave the repository or the open issues: GitHub ORs two `repo:` qualifiers, so a
 *  person's own would widen the search (Review Focus 4). A leading `-` is the negated form. */
const LEAVING = /(^|\s)-?(?:repo|org|user|owner|is):\S*/gi

const SUMMARY_MAX = 300

const memberReason = (issue: GhIssue): string | undefined =>
  (ISSUE_JOB_ASSOCIATIONS as readonly string[]).includes(issue.authorAssociation)
    ? undefined
    : `written by a ${issue.authorAssociation} of the repository; only an owner, member or collaborator's issue becomes a Job`

const itemOf = (issue: GhIssue): IssueItem => {
  const reason = memberReason(issue)
  return {
    id: String(issue.number),
    title: issue.title,
    status: issue.state,
    url: issue.url,
    ...(issue.body !== '' ? { summary: Array.from(issue.body).slice(0, SUMMARY_MAX).join('') } : {}),
    selectable: reason === undefined,
    ...(reason !== undefined ? { reason } : {})
  }
}

const failed = (message: string): GhFailed => ({ ok: false, kind: 'other', message })

/** How long a folder's repository name is kept between searches (5e, from the performance review): asking it is a second
 *  gh call, about 0.7 s, on every search pause; a folder whose remote changed is searched as it is now within a minute
 *  (4a final review M6 read it every time). */
export const REPO_NAME_TTL_MS = 60_000
/** The names read, per gh runner (one per Host) and folder. */
const repoNames = new WeakMap<GhRunner, Map<string, { slug: string; at: number }>>()

/** A page of the open issues of the repository at `cwd`, searched with `query` when there is one. A search reads the
 *  repository's name first, at most once a minute per folder (REPO_NAME_TTL_MS), and keeps the issues of that repository
 *  alone (4a final review M5). */
export async function listIssueItems(
  gh: GhRunner,
  cwd: string,
  /** `mine` (W6-A): only the issues assigned to the person gh is logged in as (`assignee:@me`). */
  q: { query?: string; cursor?: string; mine?: boolean },
  now: () => number = Date.now
): Promise<{ ok: true; items: IssueItem[]; nextCursor?: string } | GhFailed> {
  const page = q.cursor === undefined || q.cursor === '' ? 1 : /^[1-9][0-9]{0,3}$/.test(q.cursor) ? Number(q.cursor) : NaN
  if (!Number.isFinite(page)) return failed(`the cursor ${q.cursor} is not a page number`)
  const query = `${(q.query ?? '').replace(LEAVING, ' ')}${q.mine === true ? ' assignee:@me' : ''}`.replace(/\s+/g, ' ').trim()
  let raw: unknown[]
  /** The repository a search was kept to, in GitHub's case-blind form; null for the list, which is the repository's. */
  let searched: string | null = null
  if (query === '') {
    const r = await gh(['api', `repos/{owner}/{repo}/issues?state=open&per_page=${GITHUB_PAGE}&page=${page}`], cwd)
    if (!r.ok) return { ok: false, ...ghFailureSentence(r) }
    const parsed = parseJson(r.stdout)
    if (!Array.isArray(parsed)) return failed('gh api answered with something that is not a list of issues')
    raw = parsed
  } else {
    const names = repoNames.get(gh) ?? new Map<string, { slug: string; at: number }>()
    repoNames.set(gh, names)
    const known = names.get(cwd)
    let slug: string
    if (known !== undefined && now() - known.at < REPO_NAME_TTL_MS) slug = known.slug
    else {
      const named = await gh(['api', 'repos/{owner}/{repo}', '--jq', '.full_name'], cwd)
      if (!named.ok) return { ok: false, ...ghFailureSentence(named) }
      slug = named.stdout.trim()
      if (!/^[^/\s]+\/[^/\s]+$/.test(slug)) return failed('gh api answered with something that is not a repository name')
      names.set(cwd, { slug, at: now() })
    }
    searched = slug.toLowerCase()
    const r = await gh(
      ['api', '-X', 'GET', 'search/issues', '-f', `q=repo:${slug} is:issue is:open ${query}`, '-f', `per_page=${GITHUB_PAGE}`, '-f', `page=${page}`],
      cwd
    )
    if (!r.ok) return { ok: false, ...ghFailureSentence(r) }
    const parsed = parseJson(r.stdout) as { items?: unknown } | null
    if (parsed === null || !Array.isArray(parsed.items)) return failed('gh api answered with something that is not a search of issues')
    raw = parsed.items
  }
  const items = raw.flatMap((v) => {
    const issue = issueFrom(v)
    if (issue === null || issue.isPullRequest) return []
    return searched !== null && repoOf(issue.url).toLowerCase() !== searched ? [] : [itemOf(issue)]
  })
  return { ok: true, items, ...(raw.length === GITHUB_PAGE ? { nextCursor: String(page + 1) } : {}) }
}

/** Issue `id` read whole, checked and cut as a plugin's item is (4a final review M1), and whether it may become a Job. */
export async function issueDetail(
  gh: GhRunner,
  cwd: string,
  id: string
): Promise<{ ok: true; detail: SourceDetail; cut: boolean; selectable: boolean; reason?: string; issue: GhIssue } | GhFailed> {
  if (!/^[1-9][0-9]{0,9}$/.test(id)) return { ok: false, kind: 'not-found', message: `${id} is not an issue number` }
  const read = await readIssue(gh, cwd, Number(id))
  if (!read.ok) return read
  const issue = read.issue
  if (issue.isPullRequest) return { ok: false, kind: 'not-found', message: `#${issue.number} is a pull request, not an issue` }
  const reason = issue.state === 'closed' ? `Issue #${issue.number} is closed` : memberReason(issue)
  const detail = itemDetail({
    id: String(issue.number),
    title: issue.title,
    status: issue.state,
    url: issue.url,
    ...(issue.body !== '' ? { body: issue.body } : {}),
    fields: { author: issue.author, ...(issue.labels.length > 0 ? { labels: issue.labels.join(', ') } : {}) }
  })
  if (!detail.ok) return failed(`gh answered with an issue that is not an item: ${detail.problem}`)
  return {
    ok: true,
    issue,
    detail: detail.value,
    cut: detail.cut,
    selectable: reason === undefined,
    ...(reason !== undefined ? { reason } : {})
  }
}

/** What a Job made from `issue` is to do: its title, with its body as the evidence; cut as a plugin's context is (4a
 *  final review M1). */
export function issueContext(issue: GhIssue): SourceContext {
  const raw: SourceContext = {
    objective: issue.title.trim() !== '' ? issue.title : `Issue #${issue.number}`,
    sourceLabel: `GitHub issue #${issue.number} in ${repoOf(issue.url)}`,
    sourceUrl: issue.url,
    ...(issue.body !== '' ? { evidence: [{ label: 'Body', content: issue.body }] } : {}),
    ...(issue.labels.length > 0 ? { metadata: { labels: issue.labels.join(', ') } } : {})
  }
  // Always the shape: the objective and the label are never blank
  const checked = jobContext(raw)
  return checked.ok ? checked.value : raw
}

/** W6-A: what one Job made from several issues is to do. One issue is `issueContext`'s; several are listed by number
 *  and title (the first is the Job's name), each body as its own evidence, so the one objective writer
 *  (sources/objective.ts) quotes them all as data. */
export function issuesContext(issues: readonly GhIssue[]): SourceContext {
  if (issues.length === 1) return issueContext(issues[0])
  const raw: SourceContext = {
    objective: issues.map((i) => `#${i.number} ${i.title}`).join('\n'),
    sourceLabel: `GitHub issues ${issues.map((i) => `#${i.number}`).join(', ')} in ${repoOf(issues[0].url)}`,
    evidence: issues.map((i) => ({ label: `Issue #${i.number} (${i.url})${i.labels.length > 0 ? `, labels ${i.labels.join(', ')}` : ''}`, content: i.body !== '' ? i.body : '(no body)' }))
  }
  const checked = jobContext(raw)
  return checked.ok ? checked.value : raw
}

/** W7-D (#68): the name of a Job made from `issues`: the first by number and title, and how many more ("#1 unique() is
 *  O(n²) +1"). The PR of the plan carries the same name. */
export const issuesTitleOf = (issues: readonly GhIssue[]): string =>
  `#${issues[0].number} ${issues[0].title.trim()}${issues.length > 1 ? ` +${issues.length - 1}` : ''}`.trim()

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
