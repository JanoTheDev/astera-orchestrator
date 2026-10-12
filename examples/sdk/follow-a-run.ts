// Print a Run's timeline as it happens, until the Run ends.
//
//   node follow-a-run.ts <runId>
//
// Ctrl+C stops following; the Run goes on (ending a call is not stopping a Run: astera.runs.stop does that). The exit
// code is the one `astera runs wait` gives: 0 completed, 10 failed, 8 waiting for a person or a usage limit, and an
// error's own code otherwise; 130 after Ctrl+C.
import { createAsteraClient, EXIT_CODES, isAsteraError } from '@astera-app/client'

const runId = process.argv[2]
if (runId === undefined) {
  console.error('usage: node follow-a-run.ts <runId>')
  process.exit(EXIT_CODES.INVALID_ARGUMENTS)
}

const stop = new AbortController()
process.once('SIGINT', () => stop.abort())
/** Events already printed, by kind and source: a follow started again hands the timeline over from its start. */
const shown = new Set<string>()

try {
  const astera = await createAsteraClient()
  try {
    // The Host ends a follow after an hour with `timeout`; the Run goes on, so follow it again
    for (let again = true; again; ) {
      again = false
      for await (const item of astera.runs.follow(runId, { signal: stop.signal })) {
        if ('event' in item) {
          const e = item.event
          if (shown.has(`${e.kind}:${e.sourceId}`)) continue
          shown.add(`${e.kind}:${e.sourceId}`)
          console.log(`${e.at}  ${e.taskTitle !== undefined ? `[${e.taskTitle}] ` : ''}${e.summary}`)
          continue
        }
        const end = item.ending
        if (end.state === 'timeout') {
          console.log('still going after an hour; following on')
          again = true
          continue
        }
        console.log(`ended: ${end.state} (${end.progress.done} of ${end.progress.total} tasks done)`)
        process.exitCode = end.state === 'completed' ? 0 : end.state === 'failed' ? EXIT_CODES.RUN_FAILED : EXIT_CODES.WAITING_FOR_INPUT
      }
    }
  } finally {
    astera.close()
  }
} catch (e) {
  if (stop.signal.aborted) {
    console.log('stopped following; the Run goes on')
    process.exitCode = 130
  } else if (isAsteraError(e)) {
    console.error(`${e.code}: ${e.message}`)
    process.exitCode = EXIT_CODES[e.code]
  } else throw e
}
