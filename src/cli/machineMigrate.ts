// `astera machines migrate <machine>` (T12c, plan decision 18), also run by `machines add` once it has paired: brings
// this computer's setup to a paired machine over SSH. GitHub login (`gh auth token` here, `gh auth login --with-token`
// there, then `gh auth setup-git`), git identity, every Claude and Codex account, and the projects (cloned from their
// origin, registered, their settings carried). It lists exactly what moves and asks once before anything is read.
//
// Secrets (the GitHub token, a Claude setup-token) travel only on the SSH channel's stdin: never in argv, an
// environment, a log line or a file left behind, and every line shown is scrubbed of them. `--dry-run` lists the plan
// and reads no secret and runs nothing on the machine. Which logins move and why: core/accounts/exportLogin.ts.
//
// Everything that touches the world comes in through MigrateDeps, so the command lines are tested without ssh.
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { readAccountEntries } from '../core/accounts/accountsFile'
import { setupTokenCredentials, setupTokenOf } from '../core/accounts/exportLogin'
import { redactSecrets } from '../core/remote/redact'
import type { Provider } from '../core/types'
import { powershellCommand, psQuote, runExec, shQuote, sshArgs, type ExecResult, type MachineOs } from './machines'
import { answerRemote } from './remote'
import { controllerRegistry, resolveRuntime } from './runtimes'

export type MigrateKind = 'github' | 'git' | 'accounts' | 'projects'
export const MIGRATE_KINDS: readonly MigrateKind[] = ['github', 'git', 'accounts', 'projects']

export interface MigrateMachine {
  runtimeId: string
  name: string
  os: MachineOs
  /** `user@host` for ssh, and its SSH port. */
  target: string
  port: number
}
export interface MigrateOptions {
  only?: MigrateKind[]
  skip?: MigrateKind[]
  /** Which projects: all (the default) or these ids or names. */
  projects?: 'all' | string[]
  dryRun?: boolean
  /** Moves without asking. */
  yes?: boolean
}
export interface MigrateLocalAccount {
  id: string
  label: string
  color: string
  provider: Provider
  configDir: string
}
export interface MigrateLocalProject {
  id: string
  name: string
  path: string
  defaultBranch?: string
  parentId?: string
  /** The `projects set` flags its settings are, e.g. `{ delivery: 'push', 'hands-off': 'on' }`. */
  settings: Record<string, string>
}
/** One line of the plan: what moves, or why it does not. */
export interface PlanItem {
  kind: MigrateKind
  id: string
  label: string
  detail: string
  skip?: string
}
export interface ItemResult {
  kind: MigrateKind
  id: string
  label: string
  /** ok: moved; login: made there, but it needs a one-time login; skipped: not moved, and why; failed. */
  state: 'running' | 'ok' | 'login' | 'skipped' | 'failed'
  line: string
  fix?: string
}
export type MigrateResult =
  | { ok: true; dryRun: boolean; plan: PlanItem[]; results: ItemResult[] }
  | { ok: false; message: string; plan: PlanItem[]; results: ItemResult[] }

export interface MigrateDeps {
  /** Run inside an agent session (`ASTERA_SESSION` is set): refused, as `runtime pair` is. */
  agentSession: boolean
  /** A person is at a terminal: logins that need one can run there. */
  tty: boolean
  /** `ssh` with these arguments; `stdin`, when given, is written to the channel and closed. */
  exec(file: 'ssh', args: string[], o: { tty: boolean; stdin?: string }): Promise<ExecResult>
  /** A program on this computer (gh, git), its output captured. */
  local(file: string, args: string[], o?: { cwd?: string }): Promise<ExecResult>
  accounts(): Promise<MigrateLocalAccount[]>
  projects(): Promise<MigrateLocalProject[]>
  /** `claude setup-token` for this account, approved by the person in a browser; its token, or null. Absent where
   *  nobody is at a terminal (the app). */
  setupToken?(a: MigrateLocalAccount): Promise<string | null>
  /** A command over the paired link (the login check). */
  remote(cmd: string, args: Record<string, unknown>): Promise<{ ok: true; body: unknown } | { ok: false; message: string }>
  /** Shows the plan and asks once; absent means nobody can be asked (then --yes is needed). */
  confirm?(planText: string): Promise<boolean>
  now(): number
}

/** Where a project lands on the machine, from its login folder (where ssh starts). */
export const projectDir = (machineOs: MachineOs, name: string): string => {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '') || 'project'
  return machineOs === 'windows' ? `astera\\projects\\${safe}` : `astera/projects/${safe}`
}
const shownDir = (machineOs: MachineOs, rel: string): string => (machineOs === 'windows' ? `%USERPROFILE%\\${rel}` : `~/${rel}`)

/** A GitHub SSH remote as HTTPS: no SSH key moves, the machine clones with the migrated gh login. */
export function cloneUrl(origin: string): string {
  const scp = /^git@github\.com:(.+)$/.exec(origin)
  if (scp) return `https://github.com/${scp[1]}`
  const ssh = /^ssh:\/\/git@github\.com(?::\d+)?\/(.+)$/.exec(origin)
  return ssh ? `https://github.com/${ssh[1]}` : origin
}

/** The `projects set` flags a project's settings are (not its account or run configuration: their ids are this
 *  computer's). */
export function projectSettingsFlags(p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const onOff = (v: unknown): string | undefined => (typeof v === 'boolean' ? (v ? 'on' : 'off') : undefined)
  const put = (flag: string, v: string | undefined): void => {
    if (v !== undefined && v !== '') out[flag] = v
  }
  put('delivery', typeof p.delivery === 'string' ? p.delivery : undefined)
  put('delivery-branch', typeof p.deliveryBranch === 'string' ? p.deliveryBranch : undefined)
  put('auto-approve', onOff(p.autoApprove))
  put('hands-off', onOff(p.handsOff))
  put('serial-files', onOff(p.serialFiles))
  put('concurrency', typeof p.concurrency === 'number' ? String(p.concurrency) : undefined)
  put('review-rounds', typeof p.reviewRounds === 'number' ? String(p.reviewRounds) : undefined)
  put('replan', typeof p.replan === 'string' ? p.replan : undefined)
  put('prompts-dir', typeof p.promptsDir === 'string' ? p.promptsDir : undefined)
  put('auto-projects', onOff(p.autoProjects))
  put('grants', Array.isArray(p.grants) && p.grants.length > 0 ? p.grants.join(',') : undefined)
  put('coordinator-model', typeof p.coordinatorModel === 'string' ? p.coordinatorModel : undefined)
  put('origin-sync', p.originSync === 'off' ? 'off' : undefined)
  return out
}

/** The machine's own Astera CLI (installed by scripts/install-runtime.*), with these arguments; with `stdin`, the
 *  channel's input is handed to it (PowerShell does not pass it on by itself). */
export function remoteAstera(machineOs: MachineOs, args: string[], stdin = false): string {
  if (machineOs === 'linux') return ['ELECTRON_RUN_AS_NODE=1', '/opt/Astera/astera', '/opt/Astera/resources/app.asar/out/main/cli.js', ...args.map(shQuote)].join(' ')
  return powershellCommand(
    `$env:ELECTRON_RUN_AS_NODE = '1'; $d = Join-Path $env:LOCALAPPDATA 'Programs\\Astera'; ${stdin ? '[Console]::In.ReadToEnd() | ' : ''}& (Join-Path $d 'Astera.exe') (Join-Path $d 'resources\\app.asar\\out\\main\\cli.js') ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`
  )
}

const GH_WIN = "$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source; if (-not $gh) { $gh = Join-Path $env:ProgramFiles 'GitHub CLI\\gh.exe' }; "

/** Every shape a secret of this command travels in, and each secret value it read, out of a line. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join('[redacted]')
  return redactSecrets(out)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[redacted]')
    .replace(/sk-ant-[A-Za-z0-9]+-[A-Za-z0-9_-]{8,}/g, '[redacted]')
}

const tailOf = (r: ExecResult, secrets: readonly string[]): string =>
  scrub(`${r.stdout}\n${r.stderr}`, secrets)
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(-4)
    .join(' | ')

const parseData = (stdout: string): Record<string, unknown> | null => {
  const line = stdout.trim().split(/\r?\n/).pop() ?? ''
  try {
    const v = JSON.parse(line) as { data?: unknown }
    return v && typeof v.data === 'object' && v.data !== null ? (v.data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const kindsOf = (o: MigrateOptions): MigrateKind[] => MIGRATE_KINDS.filter((k) => (o.only ? o.only.includes(k) : true) && !(o.skip ?? []).includes(k))

/** What would move, read without a single secret: names, addresses and folders only. */
export async function planMigration(m: MigrateMachine, o: MigrateOptions, d: MigrateDeps): Promise<PlanItem[]> {
  const kinds = kindsOf(o)
  const plan: PlanItem[] = []
  if (kinds.includes('github')) {
    const who = await d.local('gh', ['api', 'user', '--jq', '.login'])
    const user = who.stdout.trim()
    plan.push(
      who.code === 0 && user !== ''
        ? { kind: 'github', id: 'github', label: `GitHub ${user}`, detail: 'gh login, and git over HTTPS through it (no SSH key moves)' }
        : { kind: 'github', id: 'github', label: 'GitHub', detail: '', skip: 'gh is not signed in on this computer (gh auth login)' }
    )
  }
  if (kinds.includes('git')) {
    const name = (await d.local('git', ['config', '--global', 'user.name'])).stdout.trim()
    const email = (await d.local('git', ['config', '--global', 'user.email'])).stdout.trim()
    plan.push(
      name || email
        ? { kind: 'git', id: 'git', label: `git ${name}${email ? ` <${email}>` : ''}`, detail: 'global user.name and user.email' }
        : { kind: 'git', id: 'git', label: 'git identity', detail: '', skip: 'no global user.name or user.email here' }
    )
  }
  if (kinds.includes('accounts')) {
    for (const a of await d.accounts()) {
      const how =
        a.provider === 'claude' && d.setupToken
          ? 'a long-lived token from `claude setup-token` (you approve it once in the browser)'
          : d.tty
            ? 'made there, then signed in once in this terminal'
            : 'made there; it needs a one-time login'
      plan.push({ kind: 'accounts', id: a.id, label: `${a.label} (${a.provider === 'codex' ? 'Codex' : 'Claude'})`, detail: how })
    }
  }
  if (kinds.includes('projects')) {
    const pick = o.projects && o.projects !== 'all' ? new Set(o.projects.map((x) => x.toLowerCase())) : null
    for (const p of await d.projects()) {
      if (pick && !pick.has(p.id.toLowerCase()) && !pick.has(p.name.toLowerCase())) continue
      const base = { kind: 'projects' as const, id: p.id, label: p.name }
      if (p.parentId) {
        plan.push({ ...base, detail: '', skip: 'a sub-project: its workspace is the repository that moves' })
        continue
      }
      const origin = await d.local('git', ['-C', p.path, 'remote', 'get-url', 'origin'])
      const url = origin.stdout.trim()
      if (origin.code !== 0 || url === '') {
        plan.push({ ...base, detail: '', skip: 'no origin remote to clone from' })
        continue
      }
      const dirty = (await d.local('git', ['-C', p.path, 'status', '--porcelain'])).stdout.trim() !== ''
      plan.push({
        ...base,
        detail: `${cloneUrl(url)} → ${shownDir(m.os, projectDir(m.os, p.name))}${dirty ? ' (its uncommitted work stays here)' : ''}`
      })
    }
  }
  return plan
}

export function planText(m: MigrateMachine, plan: PlanItem[]): string {
  const lines = plan.map((i) => (i.skip ? `  - ${i.label}: not moved, ${i.skip}` : `  + ${i.label}: ${i.detail}`))
  return [`To ${m.name} (${m.target}):`, ...(lines.length ? lines : ['  nothing'])].join('\n')
}

/** Moves the plan to the machine. Each item ends in one result; a failing item never stops the next. */
export async function runMigration(m: MigrateMachine, o: MigrateOptions, d: MigrateDeps, onProgress: (r: ItemResult) => void = () => undefined): Promise<MigrateResult> {
  if (d.agentSession)
    return { ok: false, message: 'astera machines migrate is for a person at their own shell or in the Astera app, not an agent session (ASTERA_SESSION is set)', plan: [], results: [] }
  const plan = await planMigration(m, o, d)
  const results: ItemResult[] = []
  const report = (r: ItemResult): void => {
    if (r.state !== 'running') results.push(r)
    onProgress(r)
  }
  for (const i of plan) if (i.skip) report({ kind: i.kind, id: i.id, label: i.label, state: 'skipped', line: `${i.label}: not moved, ${i.skip}` })
  if (o.dryRun) return { ok: true, dryRun: true, plan, results }
  const moving = plan.filter((i) => !i.skip)
  if (moving.length === 0) return { ok: true, dryRun: false, plan, results }
  if (!o.yes) {
    if (!d.confirm) return { ok: false, message: 'nothing moved: give --yes to move without being asked', plan, results }
    if (!(await d.confirm(planText(m, plan)))) return { ok: false, message: 'nothing moved: cancelled', plan, results }
  }

  const win = m.os === 'windows'
  const secrets: string[] = []
  const ssh = (command: string, x: { stdin?: string; tty?: boolean } = {}): Promise<ExecResult> =>
    d.exec('ssh', sshArgs({ target: m.target, port: m.port, tty: x.tty === true }, command), { tty: x.tty === true, ...(x.stdin !== undefined ? { stdin: x.stdin } : {}) })
  const failed = (i: PlanItem, what: string, r: ExecResult, fix: string): void =>
    report({ kind: i.kind, id: i.id, label: i.label, state: 'failed', line: scrub(`${i.label}: ${what}${r.stdout || r.stderr ? ` (${tailOf(r, secrets)})` : ''}`, secrets), fix })
  const ok = (i: PlanItem, line: string): void => report({ kind: i.kind, id: i.id, label: i.label, state: 'ok', line: scrub(line, secrets) })
  const running = (i: PlanItem, line: string): void => report({ kind: i.kind, id: i.id, label: i.label, state: 'running', line })

  for (const i of moving.filter((x) => x.kind === 'github')) {
    running(i, `Signing ${m.name} in to GitHub`)
    const tok = await d.local('gh', ['auth', 'token'])
    const token = tok.stdout.trim()
    if (tok.code !== 0 || token === '') {
      failed(i, 'could not read the gh login here', { ...tok, stdout: '' }, 'Run `gh auth login` on this computer, then try again.')
      continue
    }
    secrets.push(token)
    const has = await ssh(win ? powershellCommand(`${GH_WIN}if (Test-Path $gh) { exit 0 } else { exit 1 }`) : 'command -v gh')
    if (has.code !== 0) {
      const install = await ssh(
        win
          ? 'winget install --id GitHub.cli -e --silent --accept-source-agreements --accept-package-agreements'
          : `${d.tty ? 'sudo' : 'sudo -n'} apt-get install -y gh`,
        { tty: !win && d.tty }
      )
      if (install.code !== 0) {
        failed(i, 'could not install gh there', install, win ? 'Install GitHub CLI there (winget install GitHub.cli), then run it again.' : 'Install gh there (sudo apt-get install gh), or run this in a terminal so sudo can ask for the password.')
        continue
      }
    }
    // The token is the channel's input, never an argument: `ps` on either machine shows nothing of it
    const login = await ssh(
      win
        ? powershellCommand(`${GH_WIN}[Console]::In.ReadToEnd() | & $gh auth login --hostname github.com --with-token; if ($LASTEXITCODE) { exit $LASTEXITCODE }; & $gh auth setup-git; exit $LASTEXITCODE`)
        : 'gh auth login --hostname github.com --with-token && gh auth setup-git',
      { stdin: `${token}\n` }
    )
    if (login.code !== 0) failed(i, 'gh login there failed', login, 'Check the token works here (`gh auth status`), then run it again.')
    else ok(i, `${i.label}: signed in on ${m.name}, git uses it for HTTPS`)
  }

  for (const i of moving.filter((x) => x.kind === 'git')) {
    running(i, `Setting the git identity on ${m.name}`)
    const name = (await d.local('git', ['config', '--global', 'user.name'])).stdout.trim()
    const email = (await d.local('git', ['config', '--global', 'user.email'])).stdout.trim()
    const sets = [...(name ? [['user.name', name]] : []), ...(email ? [['user.email', email]] : [])]
    const r = await ssh(
      win
        ? powershellCommand(sets.map(([k, v]) => `git config --global ${k} ${psQuote(v)}; if ($LASTEXITCODE) { exit $LASTEXITCODE }`).join('; '))
        : sets.map(([k, v]) => `git config --global ${k} ${shQuote(v)}`).join(' && ')
    )
    if (r.code !== 0) failed(i, 'git config there failed', r, 'Install git there, then run it again.')
    else ok(i, `${i.label}: set on ${m.name}`)
  }

  const accountItems = moving.filter((x) => x.kind === 'accounts')
  const local = accountItems.length ? await d.accounts() : []
  const made: Array<{ i: PlanItem; a: MigrateLocalAccount; signedIn: boolean }> = []
  for (const i of accountItems) {
    const a = local.find((x) => x.id === i.id)
    if (!a) continue
    running(i, `Making ${i.label} on ${m.name}`)
    let login: string | undefined
    if (a.provider === 'claude' && d.setupToken) {
      const token = await d.setupToken(a)
      if (token) {
        secrets.push(token)
        login = setupTokenCredentials(token, d.now())
        secrets.push(login)
      }
    }
    const args = ['accounts', 'import', '--label', a.label, '--color', a.color, '--agent', a.provider, ...(login ? ['--login', '-'] : []), '--json']
    const r = await ssh(remoteAstera(m.os, args, login !== undefined), login ? { stdin: login } : {})
    const data = r.code === 0 ? parseData(r.stdout) : null
    if (!data) {
      failed(i, `could not make the account on ${m.name}`, r, 'Update Astera on the machine (`astera machines add` again), then run it again.')
      continue
    }
    let signedIn = data.signedIn === true
    const configDir = typeof data.configDir === 'string' ? data.configDir : ''
    if (!signedIn && d.tty && configDir !== '') {
      // A one-time login in this terminal, on the machine, into the folder just made
      const env = a.provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'
      const cli = a.provider === 'codex' ? 'codex login --device-auth' : 'claude auth login'
      report({ kind: i.kind, id: i.id, label: i.label, state: 'running', line: `Sign ${i.label} in on ${m.name}: open the link it prints on any device` })
      await ssh(win ? powershellCommand(`$env:${env} = ${psQuote(configDir)}; ${cli}; exit $LASTEXITCODE`) : `${env}=${shQuote(configDir)} ${cli}`, { tty: true })
    }
    made.push({ i, a, signedIn })
  }
  if (made.length) {
    // The machine's own login check, over the paired link
    const listed = await d.remote('accounts-list', {})
    const there = listed.ok && Array.isArray(listed.body) ? (listed.body as Array<{ label?: string; provider?: string; signedIn?: boolean }>) : null
    for (const { i, a, signedIn } of made) {
      const row = there?.find((x) => x.label === a.label && (x.provider ?? 'claude') === a.provider)
      const isIn = row ? row.signedIn === true : signedIn
      if (isIn) ok(i, `${i.label}: signed in on ${m.name}`)
      else
        report({
          kind: i.kind,
          id: i.id,
          label: i.label,
          state: 'login',
          line: `${i.label}: made on ${m.name}, needs a one-time login`,
          fix: `Run \`astera machines migrate ${m.name} --only accounts\` in a terminal to sign it in there once.`
        })
    }
  }

  const projectItems = moving.filter((x) => x.kind === 'projects')
  const projects = projectItems.length ? await d.projects() : []
  for (const i of projectItems) {
    const p = projects.find((x) => x.id === i.id)
    if (!p) continue
    running(i, `Cloning ${p.name} on ${m.name}`)
    const origin = cloneUrl((await d.local('git', ['-C', p.path, 'remote', 'get-url', 'origin'])).stdout.trim())
    const rel = projectDir(m.os, p.name)
    const there = await ssh(win ? powershellCommand(`if (Test-Path -LiteralPath ${psQuote(`${rel}\\.git`)}) { exit 0 } else { exit 1 }`) : `test -d ${shQuote(`${rel}/.git`)}`)
    const add = await ssh(remoteAstera(m.os, ['projects', 'add', '--path', rel, ...(there.code === 0 ? [] : ['--clone', origin]), '--json']))
    const data = add.code === 0 ? parseData(add.stdout) : null
    const projectId = data && typeof data.id === 'string' ? data.id : data && typeof (data.project as { id?: unknown })?.id === 'string' ? String((data.project as { id: string }).id) : null
    if (!projectId) {
      failed(i, `could not clone and register it on ${m.name}`, add, 'Check the machine reaches the origin with its gh login (`gh auth status` there), then run it again.')
      continue
    }
    const notes: string[] = []
    if (p.defaultBranch) {
      const co = await ssh(win ? powershellCommand(`git -C ${psQuote(rel)} checkout -q ${psQuote(p.defaultBranch)}; exit $LASTEXITCODE`) : `git -C ${shQuote(rel)} checkout -q ${shQuote(p.defaultBranch)}`)
      if (co.code !== 0) notes.push(`could not check out ${p.defaultBranch}`)
    }
    const flags = Object.entries(p.settings).flatMap(([k, v]) => [`--${k}`, v])
    if (flags.length) {
      const set = await ssh(remoteAstera(m.os, ['projects', 'set', projectId, ...flags, '--json']))
      if (set.code !== 0) notes.push(`its settings did not carry (${tailOf(set, secrets)})`)
    }
    ok(i, `${p.name}: cloned to ${shownDir(m.os, rel)} and registered${notes.length ? `; ${notes.join('; ')}` : ''}`)
  }
  return { ok: true, dryRun: false, plan, results }
}

export function migrationText(r: MigrateResult): string {
  const mark: Record<ItemResult['state'], string> = { running: '…', ok: 'ok', login: 'needs login', skipped: 'skipped', failed: 'FAILED' }
  const lines = r.results.map((x) => `  ${mark[x.state]}: ${x.line}${x.fix ? `\n    Fix: ${x.fix}` : ''}`)
  if (!r.ok) return [`Nothing more moved: ${r.message}`, ...lines].join('\n')
  if (r.dryRun) return ['Would move (dry run, nothing read or changed):', ...r.plan.map((i) => (i.skip ? `  - ${i.label}: not moved, ${i.skip}` : `  + ${i.label}: ${i.detail}`))].join('\n')
  return ['Moved:', ...lines].join('\n')
}

// ---- This computer's side: the files the accounts and projects come from, and the machines' SSH addresses ----

/** The accounts of this profile, for the plan. */
export async function localAccounts(profileDir: string): Promise<MigrateLocalAccount[]> {
  return (await readAccountEntries(path.join(profileDir, 'accounts.json'))).map((a) => ({
    id: a.id,
    label: a.label,
    color: a.color,
    provider: a.provider ?? 'claude',
    configDir: a.configDir
  }))
}

/** The projects of this profile, read from the Host's state file (read only). */
export async function localProjects(profileDir: string): Promise<MigrateLocalProject[]> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(path.join(profileDir, 'orchestration.json'), 'utf8'))
  } catch {
    return []
  }
  const list = (raw as { projects?: unknown })?.projects
  if (!Array.isArray(list)) return []
  return list
    .filter((p): p is Record<string, unknown> => typeof p?.id === 'string' && typeof p?.path === 'string' && typeof p?.name === 'string')
    .map((p) => ({
      id: String(p.id),
      name: String(p.name),
      path: String(p.path),
      ...(typeof p.defaultBranch === 'string' ? { defaultBranch: p.defaultBranch } : {}),
      ...(typeof p.parentId === 'string' ? { parentId: p.parentId } : {}),
      settings: projectSettingsFlags(p)
    }))
}

type KnownMachine = { target: string; port: number; os: MachineOs }
const machinesFile = (profileDir: string): string => path.join(profileDir, 'runtimes', 'machines.json')

/** The SSH address a machine was added at (`machines add`), so it can be migrated again by its Runtime id. */
export async function readMachines(profileDir: string): Promise<Record<string, KnownMachine>> {
  try {
    const v = JSON.parse(await fs.readFile(machinesFile(profileDir), 'utf8')) as unknown
    return v && typeof v === 'object' ? (v as Record<string, KnownMachine>) : {}
  } catch {
    return {}
  }
}
export async function rememberMachine(profileDir: string, runtimeId: string, m: KnownMachine): Promise<void> {
  const all = { ...(await readMachines(profileDir)), [runtimeId]: m }
  await fs.mkdir(path.dirname(machinesFile(profileDir)), { recursive: true })
  const tmp = `${machinesFile(profileDir)}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(all, null, 2))
  await fs.rename(tmp, machinesFile(profileDir))
}

export function parseKinds(v: unknown): MigrateKind[] | undefined | { error: string } {
  if (v === undefined) return undefined
  const words = String(v).split(',').map((x) => x.trim()).filter(Boolean)
  const bad = words.filter((w) => !(MIGRATE_KINDS as readonly string[]).includes(w))
  return bad.length ? { error: `${bad.join(', ')} is not one of ${MIGRATE_KINDS.join(', ')}` } : (words as MigrateKind[])
}

/** The CLI's options from its flags (`--only`, `--skip`, `--projects`, `--dry-run`, `--yes`). */
export function migrateOptionsOf(args: Record<string, unknown>): MigrateOptions | { error: string } {
  const only = parseKinds(args.only)
  const skip = parseKinds(args.skip)
  if (only && 'error' in only) return only
  if (skip && 'error' in skip) return skip
  const projects = typeof args.projects === 'string' && args.projects !== 'all' ? args.projects.split(',').map((x) => x.trim()).filter(Boolean) : 'all'
  return { ...(only ? { only } : {}), ...(skip ? { skip } : {}), projects, ...(args.dryRun === true ? { dryRun: true } : {}), ...(args.yes === true ? { yes: true } : {}) }
}

/** `claude setup-token` in this terminal: the person approves in the browser; its output is shown and read for the
 *  token. */
function cliSetupToken(a: MigrateLocalAccount, log: (m: string) => void): Promise<string | null> {
  log(`Approve a long-lived token for ${a.label} in the browser that opens (sign in there as that account)`)
  return new Promise((resolve) => {
    // windowsHide is safe for a child that needs this terminal: it shares the terminal's console through the inherited
    // stdio (no console is created for it, so there is nothing to hide), and it only hides the console Windows would
    // otherwise create when the CLI holds none, a window nobody could type into. See hideChildConsoleWindows.
    const child = spawn('claude', ['setup-token'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: a.configDir },
      stdio: ['inherit', 'pipe', 'inherit'],
      shell: process.platform === 'win32',
      windowsHide: true
    })
    let out = ''
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString()
      process.stderr.write(b)
    })
    child.on('error', () => resolve(null))
    child.on('close', () => resolve(setupTokenOf(out)))
  })
}

function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => rl.question(`${question} [y/N] `, (a) => (rl.close(), resolve(/^y(es)?$/i.test(a.trim())))))
}

/** The deps of a migration in this CLI process: the system ssh, gh and git, this profile's files and link. */
export function cliMigrateDeps(a: { profileDir: string; version: string; runtimeId: string; env: NodeJS.ProcessEnv; log(m: string): void }): MigrateDeps {
  const tty = process.stdin.isTTY === true
  return {
    agentSession: (a.env.ASTERA_SESSION ?? '') !== '',
    tty,
    exec: (file, args, x) => runExec(file, args, x),
    local: (file, args, x) => runExec(file, args, { tty: false, ...(x?.cwd ? { cwd: x.cwd } : {}) }),
    accounts: () => localAccounts(a.profileDir),
    projects: () => localProjects(a.profileDir),
    ...(tty ? { setupToken: (acc: MigrateLocalAccount) => cliSetupToken(acc, a.log), confirm: (text: string) => (process.stderr.write(`${text}\n`), askYesNo('Move these?')) } : {}),
    remote: async (cmd, args) => {
      const r = await answerRemote({ cmd, args, runtime: a.runtimeId, request: randomUUID(), profileDir: a.profileDir, mode: 'json', write: () => undefined, version: a.version })
      return 'error' in r ? { ok: false, message: r.error.message } : r.status === 200 ? { ok: true, body: r.body } : { ok: false, message: `status ${r.status}` }
    },
    now: () => Date.now()
  }
}

/** `astera machines migrate <machine>`: the machine by its Runtime id or name, its SSH address from `machines add` (or
 *  --target and --port). */
export async function runMachinesMigrate(a: { args: Record<string, unknown>; profileDir: string; version: string; env: NodeJS.ProcessEnv; log(m: string): void }): Promise<MigrateResult> {
  const fail = (message: string): MigrateResult => ({ ok: false, message, plan: [], results: [] })
  if ((a.env.ASTERA_SESSION ?? '') !== '') return fail('astera machines migrate is for a person at their own shell or in the Astera app, not an agent session (ASTERA_SESSION is set)')
  const o = migrateOptionsOf(a.args)
  if ('error' in o) return fail(o.error)
  const key = typeof a.args.machine === 'string' ? a.args.machine : ''
  if (key === '') return fail('name the machine: astera machines migrate <runtime id or name>')
  const found = resolveRuntime(await (await controllerRegistry(a.profileDir)).list(), key)
  if ('code' in found) return fail(found.message)
  const known = (await readMachines(a.profileDir))[found.runtimeId]
  const target = typeof a.args.target === 'string' && a.args.target !== '' ? a.args.target : known?.target
  if (!target) return fail(`no SSH address is known for ${found.name}: give --target user@host`)
  const port = a.args.port !== undefined ? Number(a.args.port) : (known?.port ?? 22)
  const deps = cliMigrateDeps({ ...a, runtimeId: found.runtimeId })
  let machineOs = known?.os
  if (!machineOs) {
    const probe = await runExec('ssh', sshArgs({ target, port, tty: false }, 'uname -s'), { tty: false })
    machineOs = probe.code === 0 && /^linux/i.test(probe.stdout.trim()) ? 'linux' : 'windows'
  }
  const m: MigrateMachine = { runtimeId: found.runtimeId, name: found.name, os: machineOs, target, port }
  return runMigration(m, o, deps, (r) => a.log(r.line))
}


/** `machines add`'s last step (plan decision 18): remember the machine's SSH address, then bring the setup over with
 *  the flags `machines add` was given (`--only`, `--skip`, `--projects`, `--yes`). */
export function migrateAfterPair(a: { args: Record<string, unknown>; profileDir: string; version: string; env: NodeJS.ProcessEnv; log(m: string): void }): NonNullable<import('./machines').MachineDeps['afterPair']> {
  return async (m) => {
    await rememberMachine(a.profileDir, m.runtimeId, { target: m.target, port: m.port, os: m.os })
    const o = migrateOptionsOf({ ...a.args, dryRun: undefined })
    if ('error' in o) throw new Error(o.error)
    if (kindsOf(o).length === 0) return
    const r = await runMigration(m, o, cliMigrateDeps({ ...a, runtimeId: m.runtimeId }), (x) => a.log(x.line))
    a.log(migrationText(r))
  }
}
