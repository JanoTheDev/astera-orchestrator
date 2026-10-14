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
// It is an event plugin: Astera hands its onEvent each event, in order, from where it left off, so what happened while
// it was stopped is posted when it runs again, as far back as Astera's event log keeps. A post that fails throws, and
// Astera hands the same event over again (after 1 s, doubling to 5 min, for an hour). The webhook URL and the signing
// secret are secret settings: Astera keeps them out of the plugin's log, and this plugin never writes them there anyway.
import { createHmac } from 'node:crypto'

/** @typedef {import('@astera-app/plugin-sdk').PluginContext} PluginContext */
/** @typedef {import('@astera-app/plugin-sdk').PluginDefinition} PluginDefinition */
/** @typedef {import('@astera-app/client').AsteraEvent} AsteraEvent */
/** @typedef {import('@astera-app/client').EventGap} EventGap */
/** @typedef {'run.completed' | 'run.failed' | 'completion.exhausted' | 'question.created'} Posted */
/** @typedef {import('@astera-app/client').AsteraEvent<Posted> | EventGap} Seen */

/** @type {readonly Posted[]} */
const PROBLEMS = ['run.failed', 'completion.exhausted', 'question.created']
/** @type {readonly Posted[]} */
const EVERYTHING = ['run.completed', ...PROBLEMS]
/** Well within the 30 s Astera gives onEvent. */
const POST_TIMEOUT_MS = 10_000

/**
 * Whether the event is one this plugin posts: a gap, or one of `types`.
 * @param {AsteraEvent | EventGap} e
 * @param {readonly Posted[]} types
 * @returns {e is Seen}
 */
const posted = (e, types) => e.type === 'gap' || types.some((t) => t === e.type)

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

/** Slack reads `<...>` as a mention or a link and `&` as the start of an escape, so the text escapes all three, as
 *  Slack's message format asks: a Task titled `<!channel>` does not ping a channel. The event is posted as it is. */
const escaped = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** What went wrong, in words that never hold the URL: fetch's own error says only "fetch failed", its cause says why. */
const problemOf = (/** @type {unknown} */ e) =>
  e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e)

/**
 * @typedef {object} Target
 * @property {string} url
 * @property {string | undefined} signingSecret
 */

/**
 * The webhook and the signing secret a person set; throws, saying what to do, when the URL is not one.
 * @param {PluginContext} ctx
 * @returns {Target}
 */
function targetOf(ctx) {
  const url = ctx.settings.webhookUrl
  if (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url))
    throw new Error('webhookUrl is not an http or https URL: set it with astera plugins configure, then start the plugin with astera plugins enable')
  const secret = ctx.settings.signingSecret
  return { url, signingSecret: typeof secret === 'string' && secret !== '' ? secret : undefined }
}

/**
 * Posts one event; throws when the post fails, so Astera hands the event over again.
 * @param {Target} target
 * @param {Seen} event
 * @param {PluginContext} ctx
 */
async function post(target, event, ctx) {
  const body = JSON.stringify({ text: escaped(textOf(event)), event })
  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json' }
  if (target.signingSecret !== undefined)
    headers['x-astera-signature'] = `sha256=${createHmac('sha256', target.signingSecret).update(body).digest('hex')}`
  let res
  try {
    res = await fetch(target.url, { method: 'POST', headers, body, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(POST_TIMEOUT_MS)]) })
  } catch (e) {
    throw new Error(problemOf(e))
  }
  // The answer's body is not needed; reading it to the end frees the connection.
  await res.arrayBuffer()
  if (!res.ok) throw new Error(`the webhook answered ${res.status}`)
}

/** @type {PluginDefinition} */
export default {
  // Checked at the start, so a URL that is not one fails the plugin where a person sees it
  activate(ctx) {
    targetOf(ctx)
  },
  async onEvent(event, ctx) {
    if (!posted(event, ctx.settings.onlyProblems === true ? PROBLEMS : EVERYTHING)) return
    await post(targetOf(ctx), event, ctx)
    ctx.log.info(`posted ${event.type === 'gap' ? 'a gap' : `${event.type} ${event.id}`}`)
  }
}
