// W7-F (#82): signs an account in from the app. "+" → a name → Astera runs the CLI's own login for that account's
// folder (`CLAUDE_CONFIG_DIR=<dir> claude auth login`, `CODEX_HOME=<dir> codex login`), reads the link it prints, and
// the renderer shows it with "Open in browser", "Copy" and, for claude, a box for the code to paste back.
//
// The same shape as higgsfield.ts's login: one at a time, the renderer polls `loginState`, `login` resolves when the
// CLI exits. The link holds the OAuth state: kept in memory for the dialog, never logged or written anywhere.
import { spawn } from 'node:child_process'
import type { IpcMain } from 'electron'
import type { Account, Provider } from '../core/types'
import { descriptorOf, isAmbientDir, type ProviderDescriptor } from '../core/providers/descriptor'
import { loginCodeOf, loginOutputReader } from '../core/accounts/loginUrl'

export const ACCOUNT_LOGIN_TIMEOUT_MS = 10 * 60_000

export interface LoginProc {
  onOutput(cb: (chunk: string) => void): void
  /** Resolves with the exit code once the process is gone. */
  exited: Promise<number>
  write(line: string): void
  kill(): void
}

export interface AccountLoginResult {
  ok: boolean
  reason?: 'cancelled' | 'timeout'
  message?: string
}

export interface AccountLoginState {
  id: string
  url: string | null
  asksCode: boolean
}

export function accountLoginHandlers(deps: {
  account: (id: string) => Account
  run: (account: Account) => LoginProc
  loggedIn: (id: string) => Promise<boolean>
  timeoutMs?: number
  /** T3: the CLI has exited (signed in, failed, cancelled or timed out) and the login check has answered.
   *  The account center's change signal (main/accountSync.ts `changed`): whatever the CLI did to the
   *  credentials, the row and its usage are asked again. Called before `login` resolves; a throw is ignored. */
  onFinished?: (id: string) => void | Promise<void>
}) {
  let active: { id: string; url: string | null; asksCode: boolean; proc: LoginProc; why: 'cancel' | 'timeout' | null } | null = null
  return {
    async login(idRaw: unknown): Promise<AccountLoginResult> {
      if (typeof idRaw !== 'string') throw new Error('INVALID: account id')
      const account = deps.account(idRaw) // throws for an unknown id
      // A cancelled run still exiting is waited for, not refused: a dialog closed and opened again at once (React
      // StrictMode mounts effects twice) would otherwise get BUSY.
      if (active?.why === 'cancel') await active.proc.exited.catch(() => 0)
      if (active) throw new Error('BUSY: another sign-in is running')
      const proc = deps.run(account)
      const me = { id: account.id, url: null as string | null, asksCode: false, proc, why: null as 'cancel' | 'timeout' | null }
      active = me
      const read = loginOutputReader()
      let tail = ''
      proc.onOutput((chunk) => {
        const o = read(chunk)
        me.url = o.url
        me.asksCode = o.asksCode
        tail = (tail + chunk).slice(-400)
      })
      const timer = setTimeout(() => {
        me.why ??= 'timeout'
        proc.kill()
      }, deps.timeoutMs ?? ACCOUNT_LOGIN_TIMEOUT_MS)
      const finished = (): void => {
        try {
          void Promise.resolve(deps.onFinished?.(account.id)).catch(() => {})
        } catch {
          /* the sign-in's answer does not depend on the account center hearing about it */
        }
      }
      try {
        const code = await proc.exited
        if (me.why === 'cancel') return { ok: false, reason: 'cancelled' }
        if (me.why === 'timeout') return { ok: false, reason: 'timeout' }
        if (await deps.loggedIn(account.id)) return { ok: true }
        // The last line the CLI said, minus any link: it may carry the OAuth state.
        const last = tail.replace(/https?:\/\/\S+/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop()
        return { ok: false, message: last || `the login exited with ${code}` }
      } finally {
        clearTimeout(timer)
        if (active === me) active = null
        finished()
      }
    },
    loginState(): AccountLoginState | null {
      return active ? { id: active.id, url: active.url, asksCode: active.asksCode } : null
    },
    /** The code the browser showed after sign-in, typed into the CLI's paste prompt. */
    loginCode(codeRaw: unknown): void {
      const code = loginCodeOf(codeRaw)
      if (!code) throw new Error('INVALID: code')
      if (!active) throw new Error('no sign-in is running')
      active.proc.write(`${code}\n`)
    },
    cancelLogin(): void {
      if (!active) return
      active.why = 'cancel'
      active.proc.kill()
    }
  }
}

/** The real process: the provider's login with its config-dir env, the same isolation rule as runAccountLogout. */
export function spawnAccountLogin(d: ProviderDescriptor, homeDir: string, configDir: string): LoginProc {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (isAmbientDir(d, homeDir, configDir)) delete env[d.configDirEnv]
  else env[d.configDirEnv] = configDir
  const child = spawn(d.cliFile, d.loginArgs, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true
  })
  const listeners: Array<(chunk: string) => void> = []
  const emit = (b: Buffer): void => listeners.forEach((cb) => cb(b.toString('utf8')))
  child.stdout?.on('data', emit)
  child.stderr?.on('data', emit)
  const exited = new Promise<number>((resolve) => {
    child.on('error', (err) => {
      listeners.forEach((cb) => cb(`${err.message}\n`))
      resolve(127)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
  return {
    onOutput: (cb) => void listeners.push(cb),
    exited,
    write: (line) => void child.stdin?.write(line),
    kill: () => void child.kill()
  }
}

export function registerAccountLoginIpc(
  ipcMain: IpcMain,
  deps: {
    account: (id: string) => Account
    descriptors: Record<Provider, ProviderDescriptor>
    homeDir: string
    loggedIn: (id: string) => Promise<boolean>
    onFinished?: (id: string) => void | Promise<void>
  }
): void {
  const h = accountLoginHandlers({
    account: deps.account,
    loggedIn: deps.loggedIn,
    onFinished: deps.onFinished,
    run: (a) => spawnAccountLogin(descriptorOf(deps.descriptors, a), deps.homeDir, a.configDir)
  })
  ipcMain.handle('accounts.login', (_e, id) => h.login(id))
  ipcMain.handle('accounts.loginState', () => h.loginState())
  ipcMain.handle('accounts.loginCode', (_e, code) => h.loginCode(code))
  ipcMain.handle('accounts.cancelLogin', () => h.cancelLogin())
}
