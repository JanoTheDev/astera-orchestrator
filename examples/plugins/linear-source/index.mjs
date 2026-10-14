// @ts-check
// An Astera job source for Linear: it lists your team's open issues where a person picks one to make a Job from (the
// app's Jobs view, `astera sources`, MCP's list_source_items), reads one whole, and says what a Job made from it is to
// do: the issue's title, with its description as the evidence. Astera writes the Job's objective itself, quoting the
// issue as data, and the Job keeps the issue as its source.
//
// Plain JavaScript with no dependency, so its folder installs as it is. The types are the plugin SDK's, for your
// editor and tsc only: Astera never loads @astera-app/plugin-sdk, and a plain object is the provider
// `defineJobSourceProvider` would have returned.
//
// It reads Linear's GraphQL API with a personal API key, a secret setting: Astera keeps it out of the plugin's log, and
// this plugin never writes it there anyway. It retries nothing: a failure throws, and the person reads why.

/** @typedef {import('@astera-app/plugin-sdk').PluginContext} PluginContext */
/** @typedef {import('@astera-app/plugin-sdk').JobSourceProvider} JobSourceProvider */
/** @typedef {import('@astera-app/plugin-sdk').JobSourceItem} JobSourceItem */

/** Issues a page: Linear's own default is 50; 30 keeps a person's first look short. */
const PAGE = 30
/** How much of a description a list shows. */
const SUMMARY = 200
/** Under the 15 s Astera gives each call, so the person hears Linear was slow rather than that the plugin was. */
const TIMEOUT_MS = 12_000

/**
 * @typedef {object} LinearIssue
 * @property {string} identifier
 * @property {string} title
 * @property {string} url
 * @property {string | null} [description]
 * @property {string | null} [priorityLabel]
 * @property {{ name: string } | null} [state]
 * @property {{ key: string, name: string } | null} [team]
 * @property {{ name: string } | null} [assignee]
 * @property {{ nodes: Array<{ name: string }> } | null} [labels]
 */

const LIST = `query Issues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
    nodes { identifier title url description state { name } }
    pageInfo { hasNextPage endCursor }
  }
}`

const ONE = `query Issue($id: String!) {
  issue(id: $id) {
    identifier title url description priorityLabel
    state { name } team { key name } assignee { name } labels { nodes { name } }
  }
}`

/** A setting as text, empty when it is not set. */
const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : '')

/** What went wrong, in words that never hold the key: fetch's own error says only "fetch failed", its cause says why. */
const problemOf = (/** @type {unknown} */ e) =>
  e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e)

/** The first error Linear names in an answer, if it names one. */
const firstError = (/** @type {unknown} */ json) => {
  const errors = /** @type {{ errors?: Array<{ message?: unknown }> } | null} */ (json)?.errors
  return Array.isArray(errors) && typeof errors[0]?.message === 'string' ? errors[0].message : undefined
}

/**
 * Asks Linear one GraphQL question; throws Linear's own sentence when it refuses.
 * @param {PluginContext} ctx
 * @param {string} query
 * @param {Record<string, unknown>} variables
 * @returns {Promise<any>}
 */
async function graphql(ctx, query, variables) {
  const url = text(ctx.settings.apiUrl) || 'https://api.linear.app/graphql'
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      // A personal API key goes as it is, with no "Bearer" (Linear's API docs)
      headers: { 'content-type': 'application/json', authorization: text(ctx.settings.apiKey) },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)])
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') throw new Error(`Linear did not answer within ${TIMEOUT_MS / 1000} s`)
    throw new Error(`Linear could not be reached: ${problemOf(e)}`)
  }
  let body
  try {
    body = await res.text()
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') throw new Error(`Linear did not answer within ${TIMEOUT_MS / 1000} s`)
    throw new Error(`Linear could not be reached: ${problemOf(e)}`)
  }
  /** @type {unknown} */
  let json = null
  try {
    json = JSON.parse(body)
  } catch {
    json = null
  }
  const error = firstError(json)
  if (!res.ok) throw new Error(`Linear answered ${res.status}${error !== undefined ? `: ${error}` : ''}`)
  if (error !== undefined) throw new Error(`Linear: ${error}`)
  const data = /** @type {{ data?: unknown } | null} */ (json)?.data
  if (data === undefined || data === null) throw new Error('Linear answered with no data')
  return data
}

/**
 * The issue Linear knows by `id` (`ENG-123`); throws when it knows none.
 * @param {PluginContext} ctx
 * @param {string} id
 * @returns {Promise<LinearIssue>}
 */
async function issueOf(ctx, id) {
  const data = await graphql(ctx, ONE, { id })
  if (data.issue === null || data.issue === undefined) throw new Error(`Linear has no issue ${id}`)
  return data.issue
}

/**
 * An issue as an item of the list.
 * @param {LinearIssue} issue
 * @returns {JobSourceItem}
 */
function itemOf(issue) {
  const description = issue.description ?? ''
  return {
    id: issue.identifier,
    title: issue.title,
    ...(issue.state ? { status: issue.state.name } : {}),
    url: issue.url,
    ...(description !== '' ? { summary: Array.from(description).slice(0, SUMMARY).join('') } : {})
  }
}

/** @type {JobSourceProvider} */
export default {
  // Checked at the start, so an API URL that is not one fails the plugin where a person sees it
  activate(ctx) {
    const url = text(ctx.settings.apiUrl)
    if (url !== '' && !/^https?:\/\/\S+$/.test(url))
      throw new Error('apiUrl is not an http or https URL: set it with astera plugins configure, then start the plugin with astera plugins enable')
  },

  async listItems(input, ctx) {
    const team = text(ctx.settings.teamKey)
    // Linear's state types are lower case; a person may write them otherwise, and a team key in either case
    const states = text(ctx.settings.states ?? 'unstarted,started')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s !== '')
    const filter = {
      ...(team !== '' ? { team: { key: { eqIgnoreCase: team } } } : {}),
      ...(states.length > 0 ? { state: { type: { in: states } } } : {}),
      ...(input.query ? { title: { containsIgnoreCase: input.query } } : {})
    }
    const data = await graphql(ctx, LIST, { first: PAGE, after: input.cursor ?? null, filter })
    /** @type {{ nodes: LinearIssue[], pageInfo: { hasNextPage: boolean, endCursor: string | null } } | null | undefined} */
    const issues = data.issues
    if (!issues || !Array.isArray(issues.nodes)) throw new Error('Linear answered with no issues')
    return {
      items: issues.nodes.map(itemOf),
      ...(issues.pageInfo?.hasNextPage && issues.pageInfo.endCursor ? { nextCursor: issues.pageInfo.endCursor } : {})
    }
  },

  async getItem(id, ctx) {
    const issue = await issueOf(ctx, id)
    const labels = (issue.labels?.nodes ?? []).map((l) => l.name)
    /** @type {Record<string, string>} */
    const fields = {
      ...(issue.team ? { team: issue.team.name } : {}),
      ...(issue.state ? { state: issue.state.name } : {}),
      ...(issue.priorityLabel ? { priority: issue.priorityLabel } : {}),
      ...(issue.assignee ? { assignee: issue.assignee.name } : {}),
      ...(labels.length > 0 ? { labels: labels.join(', ') } : {})
    }
    const { summary: _summary, ...item } = itemOf(issue)
    return { ...item, ...(issue.description ? { body: issue.description } : {}), fields }
  },

  async buildJobContext(id, ctx) {
    const issue = await issueOf(ctx, id)
    return {
      objective: issue.title,
      sourceLabel: `Linear ${issue.identifier}`,
      sourceUrl: issue.url,
      ...(issue.description ? { evidence: [{ label: 'Description', content: issue.description }] } : {})
    }
  }
}
