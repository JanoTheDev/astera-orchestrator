// Post what needs a person's attention to a webhook: a Slack incoming webhook, a Discord one with `/slack` added to its
// URL (Discord's Slack-compatible form, which takes `text`), or a service of your own.
//
//   WEBHOOK_URL=https://... node notify-webhook.ts [cursor-file]
//
// Posts `{ text, event }` as JSON when a Run ends, when a Task's repairs run out, and when a question for a person
// opens. It keeps a cursor in the cursor file (default: .astera-webhook-cursor in the folder it runs in): the id of the
// last event it posted, and while it waits, the subscription's own cursor, which also moves past the events it does
// not watch. Started again, it reads on from there, so a restart of it or of the Astera app loses nothing the Host
// still holds; what the Host no longer holds is posted as one "events were lost" line.
//
// Delivery is at least once. A post that fails is tried again three times (not when the webhook refuses it with a 4xx other than 429); if it still fails, the script stops
// without moving its cursor, and its next start posts that event again.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createAsteraClient, EXIT_CODES, isAsteraError, type AsteraEvent, type EventGap } from '@astera-app/client'

const url = process.env.WEBHOOK_URL
if (url === undefined || url === '') {
  console.error('usage: WEBHOOK_URL=<url> node notify-webhook.ts [cursor-file]')
  process.exit(EXIT_CODES.INVALID_ARGUMENTS)
}
const cursorFile = process.argv[2] ?? '.astera-webhook-cursor'

const TYPES = ['run.completed', 'run.failed', 'completion.exhausted', 'question.created'] as const
type Watched = (typeof TYPES)[number]

function textOf(e: AsteraEvent<Watched> | EventGap): string {
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

/** Slack reads `<...>` as a mention or a link and `&` as the start of an escape, so the text escapes all three (the
 *  webhook-notifier plugin does the same). */
const escaped = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Permanent answers: a retry gets the same one. 429 and the 5xx ones may pass. */
class Refused extends Error {}

async function post(body: unknown): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
      if (res.ok) return
      const error = new Error(`the webhook answered ${res.status}`)
      throw res.status >= 400 && res.status < 500 && res.status !== 429 ? new Refused(error.message) : error
    } catch (e) {
      if (e instanceof Refused || attempt === 4) throw e
      await sleep(500 * attempt)
    }
  }
}

/** Moves the written file over the cursor file. On Windows the move is refused for a moment while something else
 *  (a virus scanner, the search indexer) has the file open, so it is tried a few times. */
async function moveOver(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (e) {
      const code = (e as { code?: unknown }).code
      if (attempt === 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
      await sleep(100)
    }
  }
}

let saving: Promise<void> = Promise.resolve()
/** Written beside and moved over, so a crash mid-write never leaves half an id; one save at a time. */
function save(id: string): Promise<void> {
  saving = saving
    .catch(() => undefined)
    .then(async () => {
      await writeFile(`${cursorFile}.tmp`, id)
      await moveOver(`${cursorFile}.tmp`, cursorFile)
    })
  return saving
}

const stop = new AbortController()
process.once('SIGINT', () => stop.abort())

try {
  const astera = await createAsteraClient()
  try {
    let after = await readFile(cursorFile, 'utf8').then((s) => s.trim() || undefined, () => undefined)
    if (after === undefined) {
      // First start: from now, saved at once, so a crash before the first post loses nothing either
      after = await astera.events.cursor()
      await save(after)
    }
    console.log(`posting to ${url} from ${after}`)
    const sub = astera.events.subscribe({ after, types: [...TYPES], signal: stop.signal })
    // While nothing is being posted, the subscription's cursor is past everything it handed over and everything it
    // skipped: saved, a restart after a quiet spell starts there, not from a last post the Host may no longer hold
    let posting = false
    /** The cursor last handed to `save`; forgotten when that save fails, so the next tick tries again. */
    let wanted: string | undefined = after
    const idle = setInterval(() => {
      const at = sub.cursor
      if (posting || at === undefined || at === wanted) return
      wanted = at
      save(at).catch((err: unknown) => {
        if (wanted === at) wanted = undefined
        console.error(`could not save the cursor: ${String(err)}`)
      })
    }, 1000)
    try {
      for await (const e of sub) {
        posting = true
        await post({ text: escaped(textOf(e)), event: e })
        if (e.type !== 'gap') await save((wanted = e.id))
        console.log(`posted ${e.type === 'gap' ? 'a gap' : `${e.type} ${e.id}`}`)
        posting = false
      }
    } finally {
      clearInterval(idle)
    }
  } finally {
    astera.close()
  }
} catch (e) {
  if (stop.signal.aborted) process.exitCode = 130
  else if (isAsteraError(e)) {
    console.error(`${e.code}: ${e.message}`)
    process.exitCode = EXIT_CODES[e.code]
  } else {
    console.error(`stopped: ${String(e)}; the next start posts it again`)
    process.exitCode = 1
  }
}
