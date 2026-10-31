import { describe, it, expect } from 'vitest'
import { hideForkedConsoleWindows, type ChildProcessProto, type ForkHolder, type SyncStarters } from './childWindows'

/** Records what the real `fork` would have been called with. Nothing is forked. */
function holder(): { cp: ForkHolder; calls: unknown[][] } {
  const calls: unknown[][] = []
  const cp = {
    fork: (...args: unknown[]) => {
      calls.push(args)
      return {} as never
    }
  } as unknown as ForkHolder
  return { cp, calls }
}

describe('hideForkedConsoleWindows', () => {
  it('adds windowsHide to the three-argument form node-pty uses', () => {
    const { cp, calls } = holder()
    expect(hideForkedConsoleWindows(cp, 'win32')).toBe(true)
    // Exactly node-pty's call: fork(agentPath, [pid]) — the kill path in windowsPtyAgent.js.
    cp.fork('C:/app/conpty_console_list_agent', ['4242'])
    expect(calls).toEqual([['C:/app/conpty_console_list_agent', ['4242'], { windowsHide: true }]])
  })

  it('keeps the options the caller already passed', () => {
    const { cp, calls } = holder()
    hideForkedConsoleWindows(cp, 'win32')
    cp.fork('m.js', ['a'], { cwd: 'C:/somewhere', silent: true })
    expect(calls[0][2]).toEqual({ cwd: 'C:/somewhere', silent: true, windowsHide: true })
  })

  it('handles fork(path, options) — the second argument is not always an args array', () => {
    const { cp, calls } = holder()
    hideForkedConsoleWindows(cp, 'win32')
    cp.fork('m.js', { cwd: 'C:/x' })
    expect(calls).toEqual([['m.js', { cwd: 'C:/x', windowsHide: true }]])
  })

  it('never lets a caller turn it back off', () => {
    const { cp, calls } = holder()
    hideForkedConsoleWindows(cp, 'win32')
    cp.fork('m.js', ['a'], { windowsHide: false } as never)
    expect((calls[0][2] as { windowsHide: boolean }).windowsHide).toBe(true)
  })

  it('leaves fork alone off win32 — there is no console window to hide', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const { cp, calls } = holder()
      const before = cp.fork
      expect(hideForkedConsoleWindows(cp, platform)).toBe(false)
      expect(cp.fork).toBe(before)
      cp.fork('m.js', ['a'])
      expect(calls).toEqual([['m.js', ['a']]])
    }
  })
})

describe('hideAllChildConsoleWindows', () => {
  it('sets windowsHide on every spawn on win32, and keeps this and the other options', async () => {
    const { hideAllChildConsoleWindows } = await import('./childWindows')
    const seen: unknown[] = []
    const proto = {
      spawn(this: unknown, options: Record<string, unknown>) {
        seen.push([this, { ...options }])
        return 'child'
      }
    }
    const self = {}
    expect(hideAllChildConsoleWindows(proto, 'win32')).toBe(true)
    expect(proto.spawn.call(self, { file: 'git', windowsHide: false })).toBe('child')
    expect(seen).toEqual([[self, { file: 'git', windowsHide: true }]])
  })

  it('leaves the prototype alone off win32', async () => {
    const { hideAllChildConsoleWindows } = await import('./childWindows')
    const spawn = (): string => 'child'
    const proto = { spawn }
    expect(hideAllChildConsoleWindows(proto, 'linux')).toBe(false)
    expect(proto.spawn).toBe(spawn)
  })
})

describe('hideAllChildConsoleWindows with exceptDetached (the CLI and main)', () => {
  it('hides a non-detached child and leaves a detached one as its call site wrote it', async () => {
    const { hideAllChildConsoleWindows } = await import('./childWindows')
    const seen: Array<Record<string, unknown>> = []
    const proto = {
      spawn(this: unknown, options: Record<string, unknown>) {
        seen.push({ ...options })
        return 'child'
      }
    }
    hideAllChildConsoleWindows(proto, 'win32', { exceptDetached: true })
    proto.spawn({ file: 'git', detached: false, windowsHide: false })
    // electron-updater's NSIS installer: detached, a GUI program whose window SW_HIDE would hide.
    proto.spawn({ file: 'C:\Users\me\AppData\Local\astera-updater\pending\Astera-Setup.exe', detached: true, windowsHide: false })
    expect(seen.map((o) => o.windowsHide)).toEqual([true, false])
  })
})

/** Records what the real sync starters were called with. Nothing is started. */
function syncHolder(): { cp: SyncStarters; calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { spawnSync: [], execSync: [], execFileSync: [] }
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name].push(args)
      return 'out' as never
    }
  const cp = { spawnSync: rec('spawnSync'), execSync: rec('execSync'), execFileSync: rec('execFileSync') } as unknown as SyncStarters
  return { cp, calls }
}

describe('hideSyncChildConsoleWindows', () => {
  it('adds windowsHide to every form of spawnSync, execFileSync and execSync on win32', async () => {
    const { hideSyncChildConsoleWindows } = await import('./childWindows')
    const { cp, calls } = syncHolder()
    expect(hideSyncChildConsoleWindows(cp, 'win32')).toBe(true)
    cp.spawnSync('git', ['status'], { cwd: 'C:\repo' })
    cp.spawnSync('git', { cwd: 'C:\repo' })
    cp.spawnSync('git')
    cp.execFileSync('C:\Program Files\Git\cmd\git.exe', ['rev-parse', 'HEAD'])
    cp.execFileSync('where', { encoding: 'utf8' })
    cp.execSync('ver', { encoding: 'utf8', windowsHide: false })
    cp.execSync('ver')
    expect(calls.spawnSync).toEqual([
      ['git', ['status'], { cwd: 'C:\repo', windowsHide: true }],
      ['git', { cwd: 'C:\repo', windowsHide: true }],
      ['git', undefined, { windowsHide: true }]
    ])
    expect(calls.execFileSync).toEqual([
      ['C:\Program Files\Git\cmd\git.exe', ['rev-parse', 'HEAD'], { windowsHide: true }],
      ['where', { encoding: 'utf8', windowsHide: true }]
    ])
    expect(calls.execSync).toEqual([
      ['ver', { encoding: 'utf8', windowsHide: true }],
      ['ver', { windowsHide: true }]
    ])
  })

  it('returns what the real starter returned', async () => {
    const { hideSyncChildConsoleWindows } = await import('./childWindows')
    const { cp } = syncHolder()
    hideSyncChildConsoleWindows(cp, 'win32')
    expect(cp.execFileSync('git', ['--version'])).toBe('out')
  })

  it('leaves the module alone off win32', async () => {
    const { hideSyncChildConsoleWindows } = await import('./childWindows')
    for (const platform of ['darwin', 'linux'] as const) {
      const { cp } = syncHolder()
      const before = { ...cp }
      expect(hideSyncChildConsoleWindows(cp, platform)).toBe(false)
      expect(cp).toEqual(before)
    }
  })
})

describe('hideChildConsoleWindows (the guard the CLI and Electron main apply)', () => {
  function module(): {
    cp: SyncStarters & { ChildProcess: { prototype: ChildProcessProto } }
    spawned: Array<Record<string, unknown>>
    sync: Record<string, unknown[][]>
  } {
    const spawned: Array<Record<string, unknown>> = []
    const { cp: s, calls: sync } = syncHolder()
    const proto = {
      spawn(this: unknown, options: Record<string, unknown>) {
        spawned.push({ ...options })
        return 'child'
      }
    }
    return { cp: Object.assign(s, { ChildProcess: { prototype: proto } }), spawned, sync }
  }

  it('patches the async prototype and the sync starters on win32', async () => {
    const { hideChildConsoleWindows } = await import('./childWindows')
    const { cp, spawned, sync } = module()
    expect(hideChildConsoleWindows(cp, 'win32')).toBe(true)
    cp.ChildProcess.prototype.spawn({ file: 'cmd.exe', args: ['/d', '/s', '/c', 'where git'] })
    cp.spawnSync('git', ['--version'])
    expect(spawned[0].windowsHide).toBe(true)
    expect(sync.spawnSync[0][2]).toEqual({ windowsHide: true })
  })

  it('keeps the inherited stdio of a child that needs the caller terminal, and adds only windowsHide', async () => {
    // `accounts login --new` (stdio [0, 2, 2]) and `claude setup-token` (['inherit', 'pipe', 'inherit']): the child
    // shares the terminal's console through those handles; windowsHide only hides a console created for it.
    const { hideChildConsoleWindows } = await import('./childWindows')
    const { cp, spawned } = module()
    hideChildConsoleWindows(cp, 'win32')
    const login = { file: 'C:\Users\me\AppData\Roaming\npm\claude.cmd', stdio: [0, 2, 2], shell: true }
    cp.ChildProcess.prototype.spawn({ ...login })
    cp.ChildProcess.prototype.spawn({ file: 'claude', stdio: ['inherit', 'pipe', 'inherit'], shell: true })
    expect(spawned[0]).toEqual({ ...login, windowsHide: true })
    expect(spawned[1].stdio).toEqual(['inherit', 'pipe', 'inherit'])
  })

  it('does nothing off win32', async () => {
    const { hideChildConsoleWindows } = await import('./childWindows')
    for (const platform of ['darwin', 'linux'] as const) {
      const { cp, spawned } = module()
      const proto = cp.ChildProcess.prototype
      const spawn = proto.spawn
      const spawnSync = cp.spawnSync
      expect(hideChildConsoleWindows(cp, platform)).toBe(false)
      expect(proto.spawn).toBe(spawn)
      expect(cp.spawnSync).toBe(spawnSync)
      proto.spawn({ file: 'git' })
      expect(spawned).toEqual([{ file: 'git' }])
    }
  })
})
