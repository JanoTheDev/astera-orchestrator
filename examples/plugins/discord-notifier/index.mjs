// @ts-check
// An Astera notification plugin that posts to a Discord channel: each notification as an embed, its title and its
// sentence as Astera worded them in your language, coloured by how much it matters. Astera hands it a question waiting
// for an answer, a session waiting for you, a failed or finished Run, a Task whose repairs ran out, a usage limit and an
// account switch; the skip setting leaves kinds out.
//
// Plain JavaScript with no dependency, so its folder installs as it is. The types are the plugin SDK's, for your
// editor and tsc only: Astera never loads @astera-app/plugin-sdk, and a plain object is the provider
// `defineNotificationProvider` would have returned.
//
// It retries nothing itself: a post that fails throws, and Astera sends the notification again (after 1 s, doubling to
// 5 min, for an hour). The text a session, a question or a Task holds is posted as it is, and Discord is told to ping
// nobody, so `@everyone` in a question stays text. The webhook URL is a secret setting: Astera keeps it out of the
// plugin's log.

/** @typedef {import('@astera-app/plugin-sdk').NotificationProvider} NotificationProvider */
/** @typedef {import('@astera-app/plugin-sdk').NotificationLevel} NotificationLevel */
/** @typedef {import('@astera-app/plugin-sdk').PluginContext} PluginContext */

/** An embed's colour for each level: blue waits on you, red failed, amber stopped for now, green went on.
 *  @type {Record<NotificationLevel, number>} */
const COLOR = { action: 0x3b82f6, error: 0xef4444, warning: 0xf59e0b, info: 0x22c55e }
/** Well within the 30 s Astera gives send. */
const POST_TIMEOUT_MS = 10_000

/**
 * The webhook a person set; throws, saying what to do, when it is not a URL.
 * @param {PluginContext} ctx
 */
function urlOf(ctx) {
  const url = ctx.settings.webhookUrl
  if (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url))
    throw new Error('webhookUrl is not an http or https URL: set it with astera plugins configure, then start the plugin with astera plugins enable')
  return url
}

/**
 * The kinds the skip setting leaves out.
 * @param {PluginContext} ctx
 */
function skipped(ctx) {
  const skip = ctx.settings.skip
  return new Set(typeof skip === 'string' ? skip.split(',').map((k) => k.trim()).filter((k) => k !== '') : [])
}

/** What went wrong, in words that never hold the URL: fetch's own error says only "fetch failed", its cause says why. */
const problemOf = (/** @type {unknown} */ e) =>
  e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e)

/** @type {NotificationProvider} */
export default {
  // Checked at the start, so a URL that is not one fails the plugin where a person sees it
  activate(ctx) {
    urlOf(ctx)
  },
  async send(notification, ctx) {
    if (skipped(ctx).has(notification.kind)) return
    const body = JSON.stringify({
      embeds: [
        {
          title: notification.title,
          description: notification.body,
          // A level a later Astera adds is posted in the colour of `info`
          color: COLOR[/** @type {NotificationLevel} */ (notification.level)] ?? COLOR.info,
          timestamp: notification.occurredAt,
          footer: { text: notification.kind }
        }
      ],
      allowed_mentions: { parse: [] }
    })
    let res
    try {
      res = await fetch(urlOf(ctx), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(POST_TIMEOUT_MS)])
      })
    } catch (e) {
      throw new Error(problemOf(e))
    }
    // The answer's body is not needed; reading it to the end frees the connection.
    await res.arrayBuffer()
    if (!res.ok) throw new Error(`Discord answered ${res.status}`)
    ctx.log.info(`posted ${notification.kind} ${notification.id}`)
  }
}
