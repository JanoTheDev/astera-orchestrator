// @ts-check
// An Astera plugin that posts what needs a person to a webhook: a Slack incoming webhook, a Discord one with `/slack`
// added to its URL (Discord's Slack-compatible form, which takes `text`), or a service of your own. It posts
// `{ text, event }` as JSON when a Run fails, when a Task's repairs run out, when a question for a person opens, and,
// unless the onlyProblems setting is on, when a Run completes. With a signing secret set, each post carries
// `X-Astera-Signature: sha256=<hex>`, the HMAC-SHA256 of its body under that secret, so a service of your own can tell
// a post came from here.
//
// Plain JavaScript with no dependency, so its folder installs as it is. The types are the plugin SDK's, for your
// editor and tsc only: Astera never loads @astera-app/plugin-sdk, and a plain object is the plugin `definePlugin`
// would have returned.
//
// It starts from the events of the moment it starts: what happened while it was stopped is not posted. A post that
// fails is tried again three times, then given up with a warning in the plugin's log. The webhook URL and the signing
// secret are secret settings: Astera keeps them out of the plugin's log, and this plugin never writes them there anyway.
import { createHmac } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

/** @typedef {import('@astera-app/plugin-sdk').PluginContext} PluginContext */
/** @typedef {import('@astera-app/plugin-sdk').PluginDefinition} PluginDefinition */
/** @typedef {'run.completed' | 'run.failed' | 'completion.exhausted' | 'question.created'} Posted */
/** @typedef {import('@astera-app/client').AsteraEvent<Posted> | import('@astera-app/client').EventGap} Seen */

/** @type {readonly Posted[]} */
const PROBLEMS = ['run.failed', 'completion.exhausted', 'question.created']
/** @type {readonly Posted[]} */
const EVERYTHING = ['run.completed', ...PROBLEMS]
/** How long to wait before each of the three posts after a failed one. */
const RETRY_MS = [1000, 2000, 4000]
const POST_TIMEOUT_MS = 10_000

/** @param {Seen} e */
function textOf(e) {
  switch (e.type) {
    case 'gap':
      return 'Some Astera events were lost (older than the Host keeps): look in the app.'
    case 'run.completed':
      return `Run ${e.payload.id} of job ${e.payload.jobId} completed (${e.payload.progress.done} of ${e.payload.progress.total} tasks)`
    case 'run.failed':
      return `Run ${e.payload.id} of job ${e.payload.jobId} failed`
    case 'completion.exhausted':
      return `"${e.payload.title}" ran out of repairs: ${e.payload.lastFailure ?? 'look in the app'}`
    case 'question.created':
      return `A question needs a person: ${e.payload.question}`
  }
}

/** What went wrong, in words that never hold the URL: fetch's own error says only "fetch failed", its cause says why. */
const problemOf = (/** @type {unknown} */ e) =>
  e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e)

/**
 * @typedef {object} Target
 * @property {string} url
 * @property {string | undefined} signingSecret
 */

/**
 * Posts one event, trying again after a failure; false when every try failed. Ends with the signal's reason when
 * Astera stops the plugin.
 * @param {Target} target
 * @param {Seen} event
 * @param {PluginContext} ctx
 */
async function post(target, event, ctx) {
  const body = JSON.stringify({ text: textOf(event), event })
  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json' }
  if (target.signingSecret !== undefined)
    headers['x-astera-signature'] = `sha256=${createHmac('sha256', target.signingSecret).update(body).digest('hex')}`
  for (let attempt = 0; ; attempt++) {
    let problem
    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(POST_TIMEOUT_MS)])
      })
      // The answer's body is not needed; reading it to the end frees the connection.
      await res.arrayBuffer()
      if (res.ok) return true
      problem = `the webhook answered ${res.status}`
    } catch (e) {
      if (ctx.signal.aborted) throw e
      problem = problemOf(e)
    }
    if (attempt === RETRY_MS.length) {
      ctx.log.warn(`could not post ${event.type === 'gap' ? 'a gap' : `${event.type} ${event.id}`}: ${problem}`)
      return false
    }
    await sleep(RETRY_MS[attempt], undefined, { signal: ctx.signal })
  }
}

/**
 * Follows the events until Astera stops the plugin. A subscription that ends otherwise (the Host refused it, or is too
 * old for events) ends the plugin's process with a failure, so Astera starts it again, and after three such ends in a
 * row marks it failed with this log's last lines as the reason to look at. A Host that restarts does not end it: the
 * subscription waits for the new one and reads on.
 * @param {PluginContext} ctx
 * @param {Target} target
 * @param {readonly Posted[]} types
 * @param {string} after
 */
async function follow(ctx, target, types, after) {
  try {
    for await (const event of ctx.astera.events.subscribe({ after, types, signal: ctx.signal })) {
      if (await post(target, event, ctx)) ctx.log.info(`posted ${event.type === 'gap' ? 'a gap' : `${event.type} ${event.id}`}`)
    }
  } catch (e) {
    if (ctx.signal.aborted) return
    ctx.log.error(`stopped: ${problemOf(e)}`)
    // ctx.log writes to stderr, and an empty write's callback comes after every write before it: the line above is in
    // the log before the process ends.
    process.stderr.write('', () => process.exit(1))
  }
}

/** @type {PluginDefinition} */
export default {
  async activate(ctx) {
    const url = ctx.settings.webhookUrl
    if (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url))
      throw new Error('webhookUrl is not an http or https URL: set it again with astera plugins configure')
    const secret = ctx.settings.signingSecret
    const target = { url, signingSecret: typeof secret === 'string' && secret !== '' ? secret : undefined }
    const types = ctx.settings.onlyProblems === true ? PROBLEMS : EVERYTHING
    // Taken before activate returns, so a Host that refuses events fails the start, where a person sees it.
    const after = await ctx.astera.events.cursor({ signal: ctx.signal })
    void follow(ctx, target, types, after)
  }
}
