// Settings › Remote Runtimes › This computer: turning Remote Runtime on and off, making a pairing string and revoking a
// controller, from the app. It runs the CLI's own `runRuntimeCommand` (cli/runtime/commands.ts) with deps built from
// the app, so the app and `astera runtime ...` make the same checks, send the same Host commands and give the same
// answers. Opening this machine to the network is for a person, at their shell or in the app (docs/remote-runtime.md):
// the renderer is a person's clicks, never an agent session, and what it sends is checked here all the same.
import type { NetworkInterfaceInfo } from 'node:os'
import { runRuntimeCommand, type RuntimeCommandDeps } from '../../cli/runtime/commands'
import { listenChoices, privateIPv4s } from '../../core/remote/addresses'

export type ThisMachineDeps = Pick<RuntimeCommandDeps, 'readSettings' | 'writeSettings' | 'ensureIdentity' | 'loadIdentity'> & {
  /** One command to this profile's Host (the app's `orchCall`); throws when no Host answers. */
  call(cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  interfaces(): Record<string, NetworkInterfaceInfo[] | undefined>
  hostname(): string
  sleep?(ms: number): Promise<void>
}

export type ThisMachineAnswer = { ok: true; body: Record<string, unknown> } | { ok: false; code: string; message: string }

/** The longest controller name a pairing takes from Settings: a label, not a document. */
const NAME_MAX = 64

const refused = (code: string, message: string): ThisMachineAnswer => ({ ok: false, code, message })

export function createThisMachineControl(d: ThisMachineDeps) {
  const deps: RuntimeCommandDeps = {
    readSettings: d.readSettings,
    writeSettings: d.writeSettings,
    ensureIdentity: d.ensureIdentity,
    loadIdentity: d.loadIdentity,
    // The app keeps its own Host running, so there is no Host to start here: one that does not answer is down.
    hostCall: async (cmd, args) => {
      try {
        return await d.call(cmd, args)
      } catch {
        return { down: true }
      }
    },
    sleep: d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    privateAddress: () => privateIPv4s(d.interfaces())[0]?.address ?? null,
    hostname: d.hostname,
    agentSession: false
  }
  /** One command at a time: a second click waits for the first rather than racing it (review focus 5). */
  let queue: Promise<unknown> = Promise.resolve()
  const run = (cmd: string, args: Record<string, unknown>): Promise<ThisMachineAnswer> => {
    const next = queue.then(async (): Promise<ThisMachineAnswer> => {
      try {
        const r = await runRuntimeCommand(cmd, args, deps)
        return r.ok ? { ok: true, body: r.body } : refused(r.error.code, r.error.message)
      } catch (err) {
        return refused('FAILED', err instanceof Error ? err.message : String(err))
      }
    })
    queue = next.catch(() => undefined)
    return next
  }

  return {
    /** What Settings offers to listen on (core/remote/addresses.ts): never every interface. */
    addresses: () => listenChoices(d.interfaces()),
    /** Remote on, on an address this machine offers now; anything else is refused before anything is written. */
    start: async (listen: unknown): Promise<ThisMachineAnswer> => {
      if (typeof listen !== 'string' || !listenChoices(d.interfaces()).some((c) => c.address === listen))
        return refused('INVALID_ARGUMENTS', 'listen on one of the addresses this computer offers')
      return run('runtime-start', { listen })
    },
    stop: (): Promise<ThisMachineAnswer> => run('runtime-stop', {}),
    /** A pairing string: read-only unless `fullControl`, with an optional controller name. */
    pair: async (o: unknown): Promise<ThisMachineAnswer> => {
      if (o === null || typeof o !== 'object') return refused('INVALID_ARGUMENTS', 'a pairing request is { fullControl?, name? }')
      const { fullControl, name } = o as { fullControl?: unknown; name?: unknown }
      if (fullControl !== undefined && typeof fullControl !== 'boolean') return refused('INVALID_ARGUMENTS', 'fullControl is true or false')
      if (name !== undefined && (typeof name !== 'string' || name.length > NAME_MAX))
        return refused('INVALID_ARGUMENTS', `a name is text of at most ${NAME_MAX} characters`)
      const trimmed = typeof name === 'string' ? name.trim() : ''
      return run('runtime-pair', { ...(fullControl === true ? { fullControl: true } : {}), ...(trimmed !== '' ? { name: trimmed } : {}) })
    },
    revoke: async (id: unknown): Promise<ThisMachineAnswer> => {
      if (typeof id !== 'string' || id === '') return refused('INVALID_ARGUMENTS', 'a controller id is needed')
      return run('runtime-revoke', { id })
    }
  }
}

export type ThisMachineControl = ReturnType<typeof createThisMachineControl>
