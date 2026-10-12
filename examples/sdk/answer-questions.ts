// Answer the questions Astera's agents ask a person, from a terminal.
//
//   node answer-questions.ts
//
// Shows each open question, then each new one as it opens, and sends the line you type as its answer (a number picks
// one of its options). An empty line skips a question. Each is read again right before it is shown, so one answered
// elsewhere in the meantime is not asked. Ctrl+C ends it.
//
// The pattern it shows: take the event cursor first, then read the state, then follow the events from that cursor.
// Nothing that changes after the read is missed, and what the read and the events both name is handled once.
import readline from 'node:readline/promises'
import { createAsteraClient, EXIT_CODES, isAsteraError, type AsteraClient, type Question } from '@astera-app/client'

const stop = new AbortController()
const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
terminal.on('SIGINT', () => stop.abort())
process.once('SIGINT', () => stop.abort())
/** Questions already shown: an event and a read can name the same one. */
const seen = new Set<string>()

async function ask(astera: AsteraClient, named: Question): Promise<void> {
  if (seen.has(named.id) || named.status !== 'open') return
  seen.add(named.id)
  // Read again right before asking: while an earlier question was on the screen, someone may have answered this one
  const q = await astera.questions.get(named.id)
  if (q.status !== 'open') return void console.log(`${q.id} was answered elsewhere`)
  console.log(`\n${q.id} (run ${q.runId}): ${q.question}`)
  q.options?.forEach((option, i) => console.log(`  ${i + 1}. ${option}`))
  const line = (await terminal.question('answer> ', { signal: stop.signal })).trim()
  if (line === '') return void console.log('skipped')
  const n = Number(line)
  const answer = q.options !== undefined && Number.isInteger(n) && n >= 1 && n <= q.options.length ? q.options[n - 1] : line
  // Typing takes a while, and someone may answer in the app meanwhile, perhaps in the same words: look before sending
  const now = await astera.questions.get(q.id)
  if (now.status !== 'open') return void console.log(`already answered: ${now.resolution ?? ''}`)
  // The Host keeps a question's first answer and hands it back, so a second call never makes a second answer; the
  // question's id as the request id gets a retry this call's own reply
  const done = await astera.questions.answer(q.id, { answer }, { requestId: `answer-${q.id}` })
  console.log(done.resolution === answer ? 'answered' : `already answered: ${done.resolution ?? ''}`)
}

async function askOpen(astera: AsteraClient): Promise<void> {
  for (const q of (await astera.questions.list({ status: 'open' })).items) await ask(astera, q)
}

try {
  const astera = await createAsteraClient()
  try {
    const cursor = await astera.events.cursor()
    await askOpen(astera)
    for await (const e of astera.events.subscribe({ after: cursor, types: ['question.created'], signal: stop.signal })) {
      // Some events were lost (older than the Host keeps): the open questions are the truth
      if (e.type === 'gap') await askOpen(astera)
      else await ask(astera, e.payload)
    }
  } finally {
    astera.close()
  }
} catch (e) {
  if (stop.signal.aborted) process.exitCode = 130
  else if (isAsteraError(e)) {
    console.error(`${e.code}: ${e.message}`)
    process.exitCode = EXIT_CODES[e.code]
  } else throw e
} finally {
  terminal.close()
}
