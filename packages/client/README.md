# @astera-app/client

The TypeScript client for the [Astera](https://github.com/parsingk/Astera) Host. It talks to the Host on this machine
the way the `astera` CLI does: the same discovery, the same error codes and the same public fields.

```ts
import { createAsteraClient } from '@astera-app/client'

const astera = await createAsteraClient() // the installed app's Host; ASTERA_PROFILE_DIR / ASTERA_PROFILE=dev to choose
const { body } = await astera.call('jobs-list', {})
astera.close()
```

- `call(cmd, args, { requestId, signal, timeoutMs })` runs one Host command. A refusal rejects with an `AsteraError`
  whose `code` is the CLI's (`NOT_FOUND`, `HOST_NOT_RUNNING`, `VERSION_MISMATCH`, ...).
- A `requestId` makes a retry safe; an `AbortSignal` or a timeout ends the wait, not the command.
- The client does not start a Host: with none running, `createAsteraClient` rejects `HOST_NOT_RUNNING`.

Typed methods (`jobs`, `runs`, `tasks`, `questions`, ...) and events come next. **Not published yet.** It lives in the
Astera repository and will be versioned separately from the app.
