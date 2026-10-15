// @ts-check
// An Astera notification plugin that posts to a Discord channel: each notification as an embed, its title and its
// sentence as Astera worded them in your language, coloured by how much it matters. Astera hands it a question
// waiting for an answer, a session waiting for you, a failed or finished Run, a Task whose repairs ran out, a usage
// limit and an account switch; the skip setting leaves kinds out.
//
// Plain JavaScript with no dependency, so its folder installs as it is. The types are the plugin SDK's, for your
// editor and tsc only: Astera never loads @astera-app/plugin-sdk, and a plain object is the provider
// `defineNotificationProvider` would have returned.
//
// A post that fails throws, and Astera sends the notification again (after 1 s, doubling to 5 min, for an hour); the
// one wait it makes itself is a short rate limit (up to 5 s), waited out once inside the call. A post Discord would
// refuse again every time (a 4xx other than 408 and 429: malformed, unauthorized, forbidden, a webhook gone) is logged
// and left. The text a session, a question or a Task holds is posted as it is, and Discord is told to ping
// nobody, so `@everyone` in a question stays text. The webhook URL is a secret setting: Astera keeps it out of the
// plugin's log.

/** @typedef {import('@astera-app/plugin-sdk').NotificationProvider} NotificationProvider */
/** @typedef {import('@astera-app/plugin-sdk').PluginContext} PluginContext */

import { setTimeout as sleep } from 'node:timers/promises'

/** An embed's colour for each level: blue waits on you, red failed, amber stopped for now, green went on.
 *  @type {Record<string, number>} */
const COLOR = { action: 0x3b82f6, error: 0xef4444, warning: 0xf59e0b, info: 0x22c55e }
/** Well within the 30 s Astera gives send. */
const POST_TIMEOUT_MS = 10_000
/** The longest wait Discord asks for (`retry_after`, seconds) that is waited out inside one call, then posted again: a
 *  longer one is left to Astera's next try. Within the 30 s Astera gives a call, two posts included. */
const SHORT_WAIT_S = 5

/** A status Discord answers on every try for this webhook and payload (malformed, unauthorized, forbidden, gone): the
 *  notification is said and left, so the next one goes. A rate limit (429) and a timeout (408) are tried again. */
const final = (/** @type {number} */ status) => status >= 400 && status < 500 && status !== 408 && status !== 429

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

/** What went wrong, in words that never hold the URL: fetch's own error says only "fetch failed", its cause says
 *  why. */
const problemOf = (/** @type {unknown} */ e) =>
  e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e)

/**
 * What Discord said, read to the end so the connection is freed: its `message`, and a rate limit's `retry_after` in
 * seconds. Nothing when the answer is no JSON (a 204 has none).
 * @param {Response} res
 * @returns {Promise<{ message?: string, retry_after?: number }>}
 */
async function answerOf(res) {
  const text = await res.text()
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

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
          color: COLOR[notification.level] ?? COLOR.info,
          timestamp: notification.occurredAt,
          footer: { text: notification.kind }
        }
      ],
      allowed_mentions: { parse: [] }
    })
    const post = async () => {
      try {
        return await fetch(urlOf(ctx), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(POST_TIMEOUT_MS)])
        })
      } catch (e) {
        throw new Error(problemOf(e))
      }
    }
    let res = await post()
    let answer = await answerOf(res)
    // A short wait Discord asks for is waited out once, and the post made again
    if (res.status === 429 && typeof answer.retry_after === 'number' && answer.retry_after <= SHORT_WAIT_S) {
      await sleep(answer.retry_after * 1000, undefined, { signal: ctx.signal })
      res = await post()
      answer = await answerOf(res)
    }
    if (final(res.status)) {
      const why = answer.message ? `: ${answer.message}` : ''
      ctx.log.warn(`Discord refused ${notification.kind} ${notification.id} (${res.status}${why}): it is not posted`)
      return
    }
    if (!res.ok) {
      const wait = typeof answer.retry_after === 'number' ? `; it asks to wait ${answer.retry_after} s` : ''
      throw new Error(`Discord answered ${res.status}${wait}`)
    }
    ctx.log.info(`posted ${notification.kind} ${notification.id}`)
  }
}
