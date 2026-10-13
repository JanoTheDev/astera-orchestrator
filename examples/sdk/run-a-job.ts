// Make a Job, run it and wait for it to end: the first script of docs/sdk.md, whole.
//
//   node run-a-job.ts <folder> "<objective>" [claude|codex]
//
// The Job works in <folder>, coordinated by the default account of the provider named (claude when none is). The exit
// code is the one `astera runs wait` gives: 0 completed, 10 failed, 8 waiting for a person (a question, a pause) or for
// a usage limit to reset, and an error's own code otherwise (3: no Host is running).
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createAsteraClient, EXIT_CODES, isAsteraError } from '@astera-app/client'

const [folder, objective, provider = 'claude'] = process.argv.slice(2)
if (folder === undefined || objective === undefined || (provider !== 'claude' && provider !== 'codex')) {
  console.error('usage: node run-a-job.ts <folder> "<objective>" [claude|codex]')
  process.exit(EXIT_CODES.INVALID_ARGUMENTS)
}

try {
  const astera = await createAsteraClient()
  try {
    // A request id makes a retry safe: sent again with the same id, the Host answers from its receipt instead of
    // making a second Job. Each write gets its own.
    const job = await astera.jobs.create({ cwd: path.resolve(folder), objective, coordinator: { provider } }, { requestId: randomUUID() })
    const run = await astera.jobs.run(job.id, { requestId: randomUUID() })
    console.log(`job ${job.id}, run ${run.id}: waiting for it to end`)

    // The Host gives up a wait after an hour and says `timeout`; the Run goes on, so wait again
    let end = await astera.runs.wait(run.id)
    while (end.state === 'timeout') end = await astera.runs.wait(run.id)

    switch (end.state) {
      case 'completed':
        console.log(`completed: ${end.progress.done} of ${end.progress.total} tasks`)
        break
      case 'failed': {
        console.log('failed:')
        for (const t of (await astera.completion.get(end.runId)).tasks)
          if (t.state !== 'converged') console.log(`- ${t.title}: ${t.state}${t.failureSummary !== null ? ` (${t.failureSummary})` : ''}`)
        process.exitCode = EXIT_CODES.RUN_FAILED
        break
      }
      case 'waiting': {
        const q = await astera.questions.get(end.questionId)
        console.log(`waiting for an answer to ${q.id}: ${q.question}`)
        console.log('answer it in the Astera app, or with answer-questions.ts')
        process.exitCode = EXIT_CODES.WAITING_FOR_INPUT
        break
      }
      case 'paused':
        console.log(`paused: astera.runs.resume('${end.runId}') takes it back`)
        process.exitCode = EXIT_CODES.WAITING_FOR_INPUT
        break
      case 'limited':
        console.log(`every worker waits for a usage limit to reset, the first at ${end.resetsAt}`)
        process.exitCode = EXIT_CODES.WAITING_FOR_INPUT
        break
    }
  } finally {
    astera.close()
  }
} catch (e) {
  if (!isAsteraError(e)) throw e
  console.error(`${e.code}: ${e.message}`)
  process.exitCode = EXIT_CODES[e.code]
}
