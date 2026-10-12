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

Events come next. **Not published yet.** It lives in the
Astera repository and will be versioned separately from the app.
