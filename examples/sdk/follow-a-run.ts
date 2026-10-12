// Print a Run's timeline as it happens, until the Run ends.
//
//   node follow-a-run.ts <runId>
//
// Ctrl+C stops following; the Run goes on (ending a call is not stopping a Run: astera.runs.stop does that). The exit
// code is run-a-job.ts's, and 130 after Ctrl+C.
import { createAsteraClient, EXIT_CODES, isAsteraError } from '@astera-app/client'

const runId = process.argv[2]
if (runId === undefined) {
  console.error('usage: node follow-a-run.ts <runId>')
  process.exit(EXIT_CODES.INVALID_ARGUMENTS)
}

const stop = new AbortController()
process.once('SIGINT', () => stop.abort())

try {
  const astera = await createAsteraClient()
  try {
    for await (const item of astera.runs.follow(runId, { signal: stop.signal })) {
      if ('event' in item) {
        const e = item.event
        console.log(`${e.at}  ${e.taskTitle !== undefined ? `[${e.taskTitle}] ` : ''}${e.summary}`)
        continue
      }
      const end = item.ending
      console.log(`ended: ${end.state} (${end.progress.done} of ${end.progress.total} tasks done)`)
      process.exitCode =
        end.state === 'completed' ? 0 : end.state === 'failed' ? EXIT_CODES.RUN_FAILED : end.state === 'timeout' ? EXIT_CODES.TIMEOUT : EXIT_CODES.WAITING_FOR_INPUT
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
