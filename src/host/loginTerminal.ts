// Settings › Remote Runtimes › Sign in account (T12b): a terminal on this machine running `astera accounts login --new`
// (core/accounts/cliLogin.ts), so a controller sees its login link and finishes it in the person's browser. It is a pty
// of the Host's registry marked as a session, so it streams and takes input exactly as a remote session tab does
// (gatewayLink `subscribe` serves only session ptys; remoteSessions `sessions-input`), and it ends when the login ends.
// The command is fixed here: a controller chooses nothing about what runs.
import { randomBytes } from 'node:crypto'
import type { PtyRegistry } from './registry'
import type { HostSession } from '../core/orchestration/command'
import { HOST_ONLY_ENV } from '../core/host/spawn'
import { sourcesOf } from './sessions'

export const LOGIN_TERMINAL_TITLE = 'Sign in an account'

export function createLoginTerminal(d: {
  registry: Pick<PtyRegistry, 'open'>
  /** The CLI as the Host's spawner runs it: Electron or node, and its entry (core/host/spawn.ts hostCliPaths). */
  cli: { exec: string; entry: string } | null
  profileDir: string
  home: string
  env: NodeJS.ProcessEnv
  log(m: string): void
}): () => { ok: true; session: HostSession } | { ok: false; error: string } {
  return () => {
    if (!d.cli) return { ok: false, error: 'this Host was started without the CLI paths, so it cannot open a login terminal' }
    const id = `login_${randomBytes(6).toString('hex')}`
    // The Host's own variables never reach a child (HOST_ONLY_ENV); the CLI is told which profile to write.
    const env = Object.fromEntries(Object.entries(d.env).filter(([k]) => !HOST_ONLY_ENV.test(k)))
    const opened = d.registry.open({
      id,
      file: d.cli.exec,
      args: [d.cli.entry, 'accounts', 'login', '--new'],
      opts: { cwd: d.home, cols: 100, rows: 30, env: { ...env, ELECTRON_RUN_AS_NODE: '1', ASTERA_PROFILE_DIR: d.profileDir } },
      meta: { kind: 'session', id, restore: { title: LOGIN_TERMINAL_TITLE, cwd: d.home, loginTerminal: true } }
    })
    if (!opened.ok) return { ok: false, error: opened.error }
    d.log(`accounts login: terminal ${id} opened`)
    return {
      ok: true,
      session: { id, kind: 'terminal', title: LOGIN_TERMINAL_TITLE, accountId: null, cwd: d.home, alive: true, state: 'unknown', ptyId: id, sources: sourcesOf('terminal', undefined) }
    }
  }
}
