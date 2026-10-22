import { describe, expect, it } from 'vitest'
import { addMachine, installCommand, newestDeb, parsePairLine, scpArgs, sshArgs, tailOf, type ExecResult, type MachineDeps, type MachineProgress } from './machines'

const FP = 'A'.repeat(43)
const PAIR = `astera-pair:v1:100.64.0.7:47831:SECRETCODE123:${FP}`

type Call = { file: 'ssh' | 'scp'; args: string[] }

/** A fake ssh and scp: each call answered by the first rule whose test matches its command line. */
function fakeDeps(rules: Array<[(c: Call) => boolean, ExecResult]>, over: Partial<MachineDeps> = {}) {
  const calls: Call[] = []
  const paired: Array<{ runtimeId: string; name: string; address: string; port: number }> = []
  const deps: MachineDeps = {
    exec: async (file, args) => {
      const c = { file, args }
      calls.push(c)
      return rules.find(([t]) => t(c))?.[1] ?? { code: 0, stdout: '', stderr: '' }
    },
    tty: false,
    installers: async () => ['/repo/dist-installer/astera-1.4.9-amd64.deb', '/repo/dist-installer/astera-1.4.14-amd64.deb', '/repo/dist-installer/astera-1.4.14-x86_64.AppImage'],
    scriptsDir: () => '/repo/scripts',
    exists: () => true,
    random: () => 'r4nd',
    paired: async () => paired,
    pair: async (pairing) => {
      expect(pairing).toBe(PAIR)
      paired.push({ runtimeId: 'rt_1', name: 'box', address: '100.64.0.7', port: 47831 })
      return { ok: true, runtimeId: 'rt_1', name: 'box' }
    },
    ping: async () => true,
    ...over
  }
  return { deps, calls, paired }
}

const last = (c: Call): string => c.args[c.args.length - 1]
const linuxRules = (install: ExecResult): Array<[(c: Call) => boolean, ExecResult]> => [
  [(c) => c.file === 'ssh' && last(c) === 'uname -s', { code: 0, stdout: 'Linux\n', stderr: '' }],
  [(c) => c.file === 'ssh' && last(c).startsWith('mktemp'), { code: 0, stdout: '/tmp/astera-r4nd-abc\n', stderr: '' }],
  [(c) => c.file === 'ssh' && last(c).startsWith('bash '), install]
]
const installed: ExecResult = { code: 0, stdout: `Reading package lists...\nsetup: ok\nASTERA_PAIR=${PAIR}\n`, stderr: '' }

describe('machines add command lines (T12b)', () => {
  it('builds ssh with BatchMode, the port, and the target after --', () => {
    expect(sshArgs({ target: 'me@box', port: 2222, tty: false }, 'uname -s')).toEqual(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-p', '2222', '--', 'me@box', 'uname -s'])
    expect(sshArgs({ target: 'me@box', port: 22, tty: true }, 'x')).toContain('-tt')
  })
  it('builds scp to the folder, with forward slashes for a Windows one', () => {
    expect(scpArgs({ target: 'me@win', port: 22 }, ['/a/Setup.exe', '/s/install-runtime.ps1'], 'C:\\Users\\me\\AppData\\Local\\Temp\\astera-x')).toEqual([
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-P', '22', '--', '/a/Setup.exe', '/s/install-runtime.ps1', 'me@win:C:/Users/me/AppData/Local/Temp/astera-x/'
    ])
  })
  it('runs the Linux script with the .deb and setup flags, each quoted', () => {
    expect(installCommand({ target: 'x', name: "Jo's box", tailscale: true, fullControl: true }, 'linux', '/tmp/d', 'astera-1.4.14-amd64.deb')).toBe(
      "bash '/tmp/d/install-runtime.sh' '/tmp/d/astera-1.4.14-amd64.deb' '--tailscale' '--name' 'Jo'\\''s box' '--full-control'"
    )
  })
  it('runs the Windows script as one encoded PowerShell command with its own flag names', () => {
    const cmd = installCommand({ target: 'x', listen: '10.0.0.5', fullControl: true }, 'windows', 'C:\\T\\d', 'Astera-Setup.exe')
    expect(cmd).toMatch(/^powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/)
    const script = Buffer.from(cmd.split(' ').pop()!, 'base64').toString('utf16le')
    expect(script).toBe("& (Join-Path 'C:\\T\\d' 'install-runtime.ps1') -Installer (Join-Path 'C:\\T\\d' 'Astera-Setup.exe') -Listen '10.0.0.5' -FullControl")
  })
  it('picks the newest .deb by version, never an AppImage', () => {
    expect(newestDeb(['/d/astera-1.4.9-amd64.deb', '/d/astera-1.10.0-amd64.deb', '/d/astera-2.0.0-x86_64.AppImage'])).toBe('/d/astera-1.10.0-amd64.deb')
    expect(newestDeb(['/d/notes.txt'])).toBeNull()
  })
})

describe('ASTERA_PAIR= parsing and redaction (T12b)', () => {
  it('reads the last ASTERA_PAIR= line whatever came before it, tty carriage returns included', () => {
    expect(parsePairLine(`apt noise\r\nASTERA_PAIR=old\r\nmore\r\nASTERA_PAIR=${PAIR}\r\n`)).toBe(PAIR)
    expect(parsePairLine('setup failed\n')).toBeNull()
    expect(parsePairLine('echo ASTERA_PAIR=nope inline')).toBeNull()
  })
  it('keeps the tail and removes pairing strings, codes and tokens', () => {
    const t = tailOf(`l1\nASTERA_PAIR=${PAIR}\n--code 123456\n"token": "abc"\n${PAIR}`)
    expect(t).not.toContain('SECRETCODE123')
    expect(t).not.toContain('123456')
    expect(t).not.toContain('"abc"')
    expect(t).toContain('l1')
  })
})

describe('addMachine (T12b)', () => {
  it('provisions a Linux machine: one line per step, the newest .deb uploaded, paired, pinged, then afterPair', async () => {
    const after: string[] = []
    const { deps, calls } = fakeDeps(linuxRules(installed), { afterPair: async (m) => void after.push(`${m.runtimeId}:${m.os}`) })
    const steps: MachineProgress[] = []
    const r = await addMachine({ target: 'me@box', fullControl: true }, deps, (p) => steps.push(p))
    expect(r).toEqual({ ok: true, runtimeId: 'rt_1', name: 'box', os: 'linux', repaired: true })
    expect(steps.filter((s) => s.state === 'done').map((s) => s.step)).toEqual(['connect', 'detect', 'installer', 'upload', 'install', 'pair', 'verify'])
    expect(steps.at(-1)?.line).toBe('Machine box is ready')
    const scp = calls.find((c) => c.file === 'scp')!
    expect(scp.args.slice(-3)).toEqual(['/repo/dist-installer/astera-1.4.14-amd64.deb', '/repo/scripts/install-runtime.sh', 'me@box:/tmp/astera-r4nd-abc/'])
    expect(last(calls.find((c) => last(c).startsWith('bash '))!)).toContain("'--full-control'")
    expect(after).toEqual(['rt_1:linux'])
  })

  it('detects Windows when uname is not there, and needs --installer', async () => {
    const { deps } = fakeDeps([
      [(c) => last(c) === 'uname -s', { code: 1, stdout: '', stderr: "'uname' is not recognized" }],
      [(c) => last(c).includes('-EncodedCommand'), { code: 0, stdout: 'Win32NT\r\nC:\\Users\\me\\AppData\\Local\\Temp\\\r\n', stderr: '' }]
    ])
    const r = await addMachine({ target: 'me@win' }, deps)
    expect(r).toMatchObject({ ok: false, step: 'installer' })
    expect(!r.ok && r.fix).toContain('--installer')
  })

  it('does not pair again a machine that is already paired and answers', async () => {
    const { deps, paired } = fakeDeps(linuxRules(installed), { pair: async () => ({ ok: false, code: 'X', message: 'must not pair' }) })
    paired.push({ runtimeId: 'rt_9', name: 'old', address: '100.64.0.7', port: 47831 })
    const steps: MachineProgress[] = []
    expect(await addMachine({ target: 'me@box' }, deps, (p) => steps.push(p))).toMatchObject({ ok: true, runtimeId: 'rt_9', repaired: false })
    expect(steps.find((s) => s.step === 'pair' && s.state === 'skipped')).toBeTruthy()
  })

  it('refuses a target ssh would read as an option, before running anything', async () => {
    const { deps, calls } = fakeDeps([])
    expect(await addMachine({ target: '-oProxyCommand=x' }, deps)).toMatchObject({ ok: false, step: 'connect' })
    expect(calls).toEqual([])
  })

  it('reports a key that is not accepted at connect, with the fix', async () => {
    const { deps } = fakeDeps([[(c) => last(c) === 'uname -s', { code: 255, stdout: '', stderr: 'me@box: Permission denied (publickey).' }]])
    const r = await addMachine({ target: 'me@box' }, deps)
    expect(r).toMatchObject({ ok: false, step: 'connect', stderrTail: 'me@box: Permission denied (publickey).' })
    expect(!r.ok && r.fix).toContain('ssh-copy-id')
  })

  it('reports a failed upload at upload', async () => {
    const { deps } = fakeDeps([[(c: Call) => c.file === 'scp', { code: 1, stdout: '', stderr: 'scp: write: No space left on device' }], ...linuxRules(installed)])
    const r = await addMachine({ target: 'me@box' }, deps)
    expect(r).toMatchObject({ ok: false, step: 'upload', stderrTail: 'scp: write: No space left on device' })
  })

  it('reports a failed install at install, with the secrets redacted and the sudo fix', async () => {
    const { deps } = fakeDeps(linuxRules({ code: 1, stdout: `ASTERA_PAIR=${PAIR}\n--code 999999\n`, stderr: 'sudo: a terminal is required to read the password' }))
    const r = await addMachine({ target: 'me@box' }, deps)
    expect(r).toMatchObject({ ok: false, step: 'install' })
    if (r.ok) return
    expect(r.stderrTail).toContain('a terminal is required')
    expect(r.stderrTail).not.toContain('SECRETCODE123')
    expect(r.stderrTail).not.toContain('999999')
    expect(r.fix).toContain('sudo')
  })

  it('reports a pairing that fails at pair, and one that does not answer at verify', async () => {
    const refused = fakeDeps(linuxRules(installed), { pair: async () => ({ ok: false, code: 'RUNTIME_AUTH_FAILED', message: 'the code was refused' }) })
    expect(await addMachine({ target: 'me@box' }, refused.deps)).toMatchObject({ ok: false, step: 'pair', message: 'the code was refused' })
    const silent = fakeDeps(linuxRules(installed), { ping: async () => false })
    expect(await addMachine({ target: 'me@box' }, silent.deps)).toMatchObject({ ok: false, step: 'verify' })
  })
})

describe('astera machines add parsing (T12b)', () => {
  it('takes the machine as the word after add, and the flags after it', async () => {
    const { parseArgs } = await import('../core/orchestration/cliArgs')
    expect(parseArgs(['machines', 'add', 'me@box', '--port', '2222', '--full-control'])).toMatchObject({ cmd: 'machines-add', args: { target: 'me@box', port: '2222', fullControl: true } })
  })
})
