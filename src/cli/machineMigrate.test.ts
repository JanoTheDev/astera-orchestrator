import { describe, expect, it } from 'vitest'
import { cloneUrl, migrationText, planMigration, projectSettingsFlags, runMigration, scrub, type MigrateDeps, type MigrateLocalProject, type MigrateMachine } from './machineMigrate'
import type { ExecResult } from './machines'

const TOKEN = 'gho_abcdefghijklmnopqrstuvwxyz0123456789'
const SETUP = `sk-ant-oat01-${'x'.repeat(40)}`
const M: MigrateMachine = { runtimeId: 'rt_1', name: 'vps', os: 'linux', target: 'me@vps', port: 22 }
const okR = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' })

type Call = { file: string; args: string[]; stdin?: string; tty?: boolean }
function fake(over: Partial<MigrateDeps> & { ssh?: (command: string, stdin?: string) => ExecResult } = {}): { d: MigrateDeps; ssh: Call[]; local: Call[] } {
  const ssh: Call[] = []
  const local: Call[] = []
  const d: MigrateDeps = {
    agentSession: false,
    tty: false,
    exec: async (file, args, o) => {
      ssh.push({ file, args, ...(o.stdin !== undefined ? { stdin: o.stdin } : {}), tty: o.tty })
      const command = args[args.length - 1]
      if (over.ssh) return over.ssh(command, o.stdin)
      if (command.includes("'accounts' 'import'")) return okR(JSON.stringify({ ok: true, data: { configDir: '/home/me/.claude-accounts/work', signedIn: command.includes("'--login'") } }))
      if (command.includes("'projects' 'add'")) return okR(JSON.stringify({ ok: true, data: { id: 'prj_there' } }))
      if (command.startsWith('test -d')) return { code: 1, stdout: '', stderr: '' }
      return okR()
    },
    local: async (file, args) => {
      local.push({ file, args })
      const k = `${file} ${args.join(' ')}`
      if (k === 'gh api user --jq .login') return okR('octo\n')
      if (k === 'gh auth token') return okR(`${TOKEN}\n`)
      if (k === 'git config --global user.name') return okR('Octo Cat\n')
      if (k === 'git config --global user.email') return okR('octo@example.com\n')
      if (k === 'git -C /src/app remote get-url origin') return okR('git@github.com:octo/app.git\n')
      if (k === 'git -C /src/app status --porcelain') return okR(' M a.ts\n')
      if (k === 'git -C /src/loose remote get-url origin') return { code: 2, stdout: '', stderr: 'error: No such remote' }
      return okR()
    },
    accounts: async () => [{ id: 'a1', label: 'Work', color: '#123456', provider: 'claude', configDir: '/h/.claude-accounts/work' }],
    projects: async (): Promise<MigrateLocalProject[]> => [
      { id: 'p1', name: 'app', path: '/src/app', defaultBranch: 'main', settings: { delivery: 'push', 'hands-off': 'on' } },
      { id: 'p2', name: 'loose', path: '/src/loose', settings: {} }
    ],
    remote: async () => ({ ok: true, body: [{ label: 'Work', provider: 'claude', signedIn: true }] }),
    now: () => 0,
    ...over
  }
  return { d, ssh, local }
}

describe('planMigration', () => {
  it('lists GitHub user, git identity, each account and each project with origin and target folder', async () => {
    const { d } = fake({ setupToken: async () => SETUP })
    const plan = await planMigration(M, {}, d)
    expect(plan.map((i) => [i.kind, i.label, i.skip ?? i.detail])).toEqual([
      ['github', 'GitHub octo', 'gh login, and git over HTTPS through it (no SSH key moves)'],
      ['git', 'git Octo Cat <octo@example.com>', 'global user.name and user.email'],
      ['accounts', 'Work (Claude)', 'a long-lived token from `claude setup-token` (you approve it once in the browser)'],
      ['projects', 'app', 'https://github.com/octo/app.git → ~/astera/projects/app (its uncommitted work stays here)'],
      ['projects', 'loose', 'no origin remote to clone from']
    ])
  })

  it('--only and --projects narrow it', async () => {
    const plan = await planMigration(M, { only: ['projects'], projects: ['loose'] }, fake().d)
    expect(plan.map((i) => i.id)).toEqual(['p2'])
  })
})

describe('runMigration', () => {
  it('--dry-run reads no secret and runs nothing on the machine', async () => {
    const tokens: string[] = []
    const { d, ssh, local } = fake({ setupToken: async () => (tokens.push('asked'), SETUP) })
    const r = await runMigration(M, { dryRun: true }, d)
    expect(r.ok && r.dryRun).toBe(true)
    expect(ssh).toEqual([])
    expect(tokens).toEqual([])
    expect(local.some((c) => c.file === 'gh' && c.args.join(' ') === 'auth token')).toBe(false)
    expect(migrationText(r)).toMatch(/dry run/)
  })

  it('is refused inside an agent session before it reads anything', async () => {
    const { d, ssh, local } = fake({ agentSession: true })
    const r = await runMigration(M, { yes: true }, d)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/agent session/)
    expect(ssh).toEqual([])
    expect(local).toEqual([])
  })

  it('asks once, and nothing moves on no or with nobody to ask', async () => {
    const asked: string[] = []
    const no = fake({ confirm: async (t) => (asked.push(t), false) })
    expect((await runMigration(M, {}, no.d)).ok).toBe(false)
    expect(asked[0]).toMatch(/GitHub octo/)
    expect(no.ssh).toEqual([])
    const nobody = fake()
    const r = await runMigration(M, {}, nobody.d)
    expect(!r.ok && r.message).toMatch(/--yes/)
    expect(nobody.ssh).toEqual([])
  })

  it('sends the GitHub token only on stdin, never in argv', async () => {
    const { d, ssh } = fake()
    const r = await runMigration(M, { yes: true, only: ['github'] }, d)
    expect(r.results).toEqual([expect.objectContaining({ kind: 'github', state: 'ok' })])
    const login = ssh.find((c) => c.args.join(' ').includes('gh auth login'))!
    expect(login.args[login.args.length - 1]).toBe('gh auth login --hostname github.com --with-token && gh auth setup-git')
    expect(login.stdin).toBe(`${TOKEN}\n`)
    for (const c of ssh) expect(c.args.join(' ')).not.toContain(TOKEN)
  })

  it('installs gh when missing, with sudo -n when nobody is at a terminal', async () => {
    const { d, ssh } = fake({ ssh: (c) => (c === 'command -v gh' ? { code: 1, stdout: '', stderr: '' } : okR()) })
    await runMigration(M, { yes: true, only: ['github'] }, d)
    expect(ssh.map((c) => c.args[c.args.length - 1])).toContain('sudo -n apt-get install -y gh')
  })

  it('a failing step has every secret taken out of its line', async () => {
    const { d } = fake({ ssh: (c) => (c.includes('gh auth login') ? { code: 1, stdout: '', stderr: `bad token ${TOKEN} given` } : okR()) })
    const r = await runMigration(M, { yes: true, only: ['github'] }, d)
    const f = r.results[0]
    expect(f.state).toBe('failed')
    expect(f.line).not.toContain(TOKEN)
    expect(f.line).toContain('[redacted]')
  })

  it('a Claude account gets a setup-token login over stdin (refresh tokens rotate, so none is copied), then the login check', async () => {
    const { d, ssh } = fake({ setupToken: async () => SETUP })
    const r = await runMigration(M, { yes: true, only: ['accounts'] }, d)
    expect(r.results).toEqual([expect.objectContaining({ kind: 'accounts', state: 'ok', line: 'Work (Claude): signed in on vps' })])
    const imp = ssh.find((c) => c.args.join(' ').includes("'accounts' 'import'"))!
    expect(imp.args[imp.args.length - 1]).toContain("'--label' 'Work' '--color' '#123456' '--agent' 'claude' '--login' '-'")
    expect(JSON.parse(imp.stdin!).claudeAiOauth).toMatchObject({ accessToken: SETUP, refreshToken: null })
    for (const c of ssh) expect(c.args.join(' ')).not.toContain(SETUP)
  })

  it('without a terminal the account is made there and reported as needing a one-time login', async () => {
    const { d, ssh } = fake({ remote: async () => ({ ok: true, body: [{ label: 'Work', provider: 'claude', signedIn: false }] }) })
    const r = await runMigration(M, { yes: true, only: ['accounts'] }, d)
    expect(r.results[0]).toMatchObject({ state: 'login', fix: expect.stringContaining('astera machines migrate vps --only accounts') })
    expect(ssh.every((c) => c.stdin === undefined && !c.tty)).toBe(true)
  })

  it('at a terminal, an account with no token signs in once on the machine, into its new folder', async () => {
    const { d, ssh } = fake({ tty: true, setupToken: async () => null })
    await runMigration(M, { yes: true, only: ['accounts'] }, d)
    const login = ssh.find((c) => c.tty)!
    expect(login.args).toContain('-tt')
    expect(login.args[login.args.length - 1]).toBe("CLAUDE_CONFIG_DIR='/home/me/.claude-accounts/work' claude auth login")
  })

  it('clones a project with origin over HTTPS, registers it and carries its settings; one without origin is skipped with the reason', async () => {
    const { d, ssh } = fake()
    const r = await runMigration(M, { yes: true, only: ['projects'] }, d)
    expect(r.results).toEqual([
      expect.objectContaining({ id: 'p2', state: 'skipped', line: 'loose: not moved, no origin remote to clone from' }),
      expect.objectContaining({ id: 'p1', state: 'ok', line: 'app: cloned to ~/astera/projects/app and registered' })
    ])
    const commands = ssh.map((c) => c.args[c.args.length - 1])
    expect(commands).toContain(
      "ELECTRON_RUN_AS_NODE=1 /opt/Astera/astera /opt/Astera/resources/app.asar/out/main/cli.js 'projects' 'add' '--path' 'astera/projects/app' '--clone' 'https://github.com/octo/app.git' '--json'"
    )
    expect(commands).toContain("git -C 'astera/projects/app' checkout -q 'main'")
    expect(commands.find((c) => c.includes("'projects' 'set'"))).toContain("'prj_there' '--delivery' 'push' '--hands-off' 'on'")
  })

  it('on Windows the token goes through PowerShell reading stdin, and nothing secret is in the encoded command', async () => {
    const { d, ssh } = fake()
    await runMigration({ ...M, os: 'windows' }, { yes: true, only: ['github'] }, d)
    const login = ssh.find((c) => c.stdin !== undefined)!
    const script = Buffer.from(login.args[login.args.length - 1].split(' ').pop()!, 'base64').toString('utf16le')
    expect(script).toContain('[Console]::In.ReadToEnd() | & $gh auth login --hostname github.com --with-token')
    expect(script).not.toContain(TOKEN)
  })
})

describe('helpers', () => {
  it('cloneUrl turns GitHub SSH remotes into HTTPS and leaves the rest', () => {
    expect(cloneUrl('git@github.com:o/r.git')).toBe('https://github.com/o/r.git')
    expect(cloneUrl('ssh://git@github.com/o/r')).toBe('https://github.com/o/r')
    expect(cloneUrl('https://gitlab.com/o/r.git')).toBe('https://gitlab.com/o/r.git')
  })
  it('projectSettingsFlags carries the settings a projects set takes, not local ids', () => {
    expect(projectSettingsFlags({ delivery: 'push', handsOff: true, autoApprove: false, originSync: 'off', grants: ['a', 'b'], testConfigId: 'x' })).toEqual({
      delivery: 'push',
      'hands-off': 'on',
      'auto-approve': 'off',
      'origin-sync': 'off',
      grants: 'a,b'
    })
  })
  it('scrub removes the values read and the shapes tokens travel in', () => {
    expect(scrub(`a ${TOKEN} b ${SETUP} secretvalue`, ['secretvalue'])).toBe('a [redacted] b [redacted] [redacted]')
  })
})
