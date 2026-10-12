# @astera-app/client

The TypeScript client for the [Astera](https://github.com/parsingk/Astera) Host. It talks to the Host on this machine
the way the `astera` CLI does: the same discovery, the same deadlines, the same error codes and the same public
fields.

```ts
import { createAsteraClient, isAsteraError } from '@astera-app/client'

const astera = await createAsteraClient()
try {
  const { body } = await astera.call('jobs-list', {})
} catch (e) {
  if (isAsteraError(e) && e.code === 'HOST_NOT_RUNNING') {
    // open the Astera app, or run `astera host start`
  }
} finally {
  astera.close()
}
```

**Which Host.** The installed app's, unless `ASTERA_PROFILE_DIR` names a profile folder or `ASTERA_PROFILE=dev`
picks the dev app's; `ASTERA_HOST` overrides the address of the discovered profile. The options `profileDir` and
`address` override both; an explicit `profileDir` without `address` is always that profile's own Host. The client
does not start a Host: with none running, `createAsteraClient` rejects `HOST_NOT_RUNNING`.

**Calls.** `call(cmd, args, { requestId, signal, timeoutMs })` runs one Host command and resolves to
`{ body, replayed, observed }`, the body in the public shape the CLI prints.

- A refusal rejects with an `AsteraError` whose `code` is the CLI's (`NOT_FOUND`, `CONFLICT`, `VERSION_MISMATCH`, ...).
  Test it with `isAsteraError(e)` (or `instanceof AsteraError`): both hold across the package's ESM and CommonJS copies.
- An aborted `signal` rejects with the signal's own reason, an `AbortError` DOMException by default, **not** an
  `AsteraError`; its numeric `code` (20) is not one of ours, so check `isAsteraError` before reading `code`.
- A `requestId` makes a retry safe: the Host runs a command once per id. A Host that keeps no receipts refuses it.
- **Deadlines.** The handshake waits 5 s (`connectTimeoutMs`). An ordinary command waits 330 s, the CLI's
  (`callTimeoutMs`). A command that waits on the Host (`runs-wait`, `jobs-wait`, `ask`, `check`, or any call whose
  `args.timeoutMs` names the Host's deadline) waits past that deadline. `timeoutMs` on one call overrides all of it,
  the connect included. A deadline or an abort ends the wait, not the command (cancelling a call is not cancelling a
  Run).

**Closing.** An idle client does not keep Node running. `close()` still ends the connection at once, which frees the
Host's side; calls still waiting fail with `FAILED` ("the client was closed before the Host answered").

**Typed methods.** The same commands with typed inputs and answers (`Project`, `Job`, `Run`, `Task`, `Question`,
`RunCompletion`, ...). When the app builds, each answer type is checked against the app's own types, or against the
code that builds the answer where the app has no type for it:

```ts
const job = await astera.jobs.create({ objective: 'Refactor auth', projectId, coordinator: { provider: 'claude' } }, { requestId })
const run = await astera.jobs.run(job.id)
for await (const item of astera.runs.follow(run.id)) {
  if ('event' in item) console.log(item.event.summary)
  else console.log('ended:', item.ending.state) // completed, failed, waiting, paused, limited or timeout
}
```

| Namespace | Methods |
|---|---|
| `projects` | `list`, `get` |
| `jobs` | `list({ status, projectId })`, `get`, `create`, `run`, `wait` |
| `runs` | `list({ jobId })`, `get`, `wait`, `follow`, `stop`, `resume` |
| `tasks` | `list({ runId, status, ready, brief })`, `get`, `create` |
| `questions` | `list({ runId, taskId, status })`, `get`, `answer` |
| `completion` | `get` (read only: whether work is done stays Astera's call) |

- Lists come back as `{ items }`. The Host answers whole lists today; `nextCursor` will appear when it pages.
- A wait or a follow ends with data, not an error: `completed`, `failed`, `waiting` (a question for a person),
  `paused`, `limited` (every worker waits for a usage limit) or `timeout`.
- Words follow the Host: a question's status is `open` or `resolved`, and a Run is stopped (paused, `resume`
  takes it back); there is no cancel.
- `jobs.create` takes a `projectId` (its folder is looked up) or an absolute `cwd`; a relative one is refused, since
  the Host would resolve it against its own folder. With no `coordinator`, the Job runs only the Tasks added to it, as
  with the CLI. `tasks.create` without `accountIds` uses the Job's coordinator account, and is refused when the Job
  has none.
- `runs.follow` throws when the Run is deleted (`NOT_FOUND`) or the Host goes away (`HOST_NOT_RUNNING`); it does not
  pick up where it left off. Leaving the loop (`break`, `return()`) or aborting its signal ends the call it is waiting
  on.
- Write methods take a `requestId`; read methods and the lookups a write does first (a project's folder, a Job's
  coordinator) never send one. A `timeoutMs` applies to each Host call, a lookup included.

**Events.** The Host keeps a log of what happens to Jobs, Runs, Tasks, questions and completion, and `events` reads
it:

```ts
for await (const e of astera.events.subscribe({ types: ['run.completed', 'run.failed', 'completion.exhausted'] })) {
  if (e.type === 'gap') continue // some events were lost: read the objects again
  if (e.type === 'completion.exhausted') console.log('needs a person:', e.payload.title)
  else console.log(e.runId, e.payload.outcome)
}
```

| Type | When | Payload |
|---|---|---|
| `job.created`, `job.updated` | a Job is made; one of its own fields changes (not its derived outcome or progress) | `Job` |
| `run.started` | a Run is made | `Run` |
| `run.completed`, `run.failed` | its Tasks' outcome leaves `running` | `Run` |
| `task.started` | a Task is dispatched (a retry or a repair included) | `Task` |
| `task.completed`, `task.failed` | a Task completes; fails (a failure it will retry included) | `Task` |
| `question.created`, `question.answered` | a question for a person opens; is answered | `Question` |
| `completion.started` | a Task's first check starts | `TaskCompletion` |
| `completion.failed` | a check or review round fails | `TaskCompletion` |
| `completion.repair_started` | a repair of a failed check or review starts | `TaskCompletion` |
| `completion.converged`, `completion.exhausted` | a Task is done; its repairs ran out | `TaskCompletion` |

- An event is `{ id, type, sequence, occurredAt, projectId?, jobId?, runId?, taskId?, payload }`, the payload the
  object as it stood right after the change. A Task is cut like `tasks.list({ brief: true })` and its checks carry no
  output; `get` reads the whole object.
- Events are notifications, not the state. Delivery is at least once; an `id` never repeats, so drop one you have
  seen. `sequence` orders the events of one log.
- `subscribe()` starts with what happens next; `subscribe({ after })` reads on from an event id or a cursor.
  `list({ after, types, limit })` answers one page `{ items, nextCursor, gap }` from the oldest event the Host holds,
  without waiting: pass `nextCursor` back to read on, or to `subscribe`.
- A `{ type: 'gap' }` (or `gap: true`) means events between your cursor and the next one are gone: older than the
  Host keeps (at least the last 1000 events, across Host restarts), or a cursor from a log this Host does not hold.
- A subscription outlives a Host restart: a call that fails because the Host went away or did not answer is sent
  again from the same cursor after 250 ms, 1 s, then every 5 s. It ends only on `break`/`return()`, its `signal`, or
  an error waiting cannot mend (a Host too old for events answers `VERSION_MISMATCH`).
- Not produced yet: `run.cancelled` (there is no cancel; a stop pauses), `github.*`, `runtime.*`. Local Host only for
  now.

**Not published yet.** It lives in the Astera repository and will be versioned separately from the app.
