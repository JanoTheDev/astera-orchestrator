// The Windows window diagnostic: watcher lines in, log lines out. Nothing here starts a process.
import { describe, expect, it } from 'vitest'
import {
  WINDOW_DIAGNOSTIC_SUMMARY_MS,
  classifyWindow,
  createWindowDiagnostic,
  encodedScript,
  parseWindowEvent,
  type WindowShown
} from './windowDiagnostic'

const shown = (o: Partial<WindowShown> & { chain?: Array<{ pid: number; name: string }> }): string =>
  JSON.stringify({ kind: 'shown', hwnd: 100, pid: 11, cls: 'ConsoleWindowClass', title: '', cmd: 'x.exe', chain: [{ pid: 11, name: 'x.exe' }], ...o })

describe('parseWindowEvent', () => {
  it('reads a shown window and a late title', () => {
    expect(parseWindowEvent(shown({ hwnd: 7, pid: 3, cls: 'CASCADIA_HOSTING_WINDOW_CLASS', title: 't', cmd: 'c', chain: [{ pid: 3, name: 'a.exe' }, { pid: 1, name: 'h.exe' }] }))).toEqual({
      kind: 'shown',
      hwnd: 7,
      pid: 3,
      cls: 'CASCADIA_HOSTING_WINDOW_CLASS',
      title: 't',
      cmd: 'c',
      chain: [
        { pid: 3, name: 'a.exe' },
        { pid: 1, name: 'h.exe' }
      ]
    })
    expect(parseWindowEvent(JSON.stringify({ kind: 'title', hwnd: 7, title: 'C:\\x\\node.exe' }))).toEqual({ kind: 'title', hwnd: 7, title: 'C:\\x\\node.exe' })
  })

  it('takes a one-link chain written as an object (ConvertTo-Json unwraps a one-element array)', () => {
    const e = parseWindowEvent(JSON.stringify({ kind: 'shown', hwnd: 1, pid: 2, cls: 'c', chain: { pid: 2, name: 'n.exe' } }))
    expect(e && e.kind === 'shown' && e.chain).toEqual([{ pid: 2, name: 'n.exe' }])
  })

  it('drops what it cannot read', () => {
    for (const l of ['', 'not json', '[]', '{"kind":"shown","hwnd":1}', '{"kind":"other","hwnd":1}', '{"kind":"title"}']) expect(parseWindowEvent(l)).toBeNull()
  })
})

describe('classifyWindow', () => {
  const e = (cls: string, chain: number[]): WindowShown => ({ kind: 'shown', hwnd: 1, pid: chain[0], cls, title: '', cmd: '', chain: chain.map((pid) => ({ pid, name: 'p' })) })
  it('a window under the Host is the Host’s, whatever its class', () => {
    expect(classifyWindow(e('Chrome_WidgetWin_1', [5, 4, 1]), 1)).toBe('host')
  })
  it('any console or terminal window counts: a handed-off console belongs to Windows Terminal, not the Host', () => {
    for (const cls of ['ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS', 'PseudoConsoleWindow']) expect(classifyWindow(e(cls, [5, 9]), 1)).toBe('console')
  })
  it('ignores other windows', () => {
    expect(classifyWindow(e('Notepad', [5, 9]), 1)).toBeNull()
  })
})

describe('encodedScript', () => {
  it('is the UTF-16LE base64 -EncodedCommand takes, and names the pid variable rather than holding a pid', () => {
    const text = Buffer.from(encodedScript(), 'base64').toString('utf16le')
    expect(text).toContain('ASTERA_WINDOW_DIAGNOSTIC_HOST_PID')
    expect(text).toContain('EnumWindows')
  })
})

describe('createWindowDiagnostic', () => {
  function setup(o: { platform?: NodeJS.Platform; enabled?: boolean } = {}) {
    let clock = 0
    let enabled = o.enabled ?? true
    const lines: string[] = []
    const watches: Array<{ pid: number; emit: (l: string) => void; exit: (why: string) => void; stopped: boolean }> = []
    const d = createWindowDiagnostic({
      platform: o.platform ?? 'win32',
      hostPid: 1,
      enabled: async () => enabled,
      watch: (pid, onLine, onExit) => {
        const w = { pid, emit: onLine, exit: onExit, stopped: false }
        watches.push(w)
        return { stop: () => (w.stopped = true) }
      },
      log: (m) => lines.push(m),
      now: () => clock
    })
    return { d, lines, watches, setEnabled: (v: boolean) => (enabled = v), advance: (ms: number) => (clock += ms) }
  }

  it('starts one watcher with the Host pid and logs Host windows and console windows as they appear', async () => {
    const s = setup()
    await s.d.tick()
    await s.d.tick()
    expect(s.watches).toHaveLength(1)
    expect(s.watches[0].pid).toBe(1)
    s.watches[0].emit(shown({ hwnd: 5, pid: 11, cls: 'ConsoleWindowClass', cmd: 'git.exe status', chain: [{ pid: 11, name: 'git.exe' }, { pid: 1, name: 'astera-host.exe' }] }))
    s.watches[0].emit(shown({ hwnd: 6, pid: 30, cls: 'CASCADIA_HOSTING_WINDOW_CLASS', title: '', cmd: 'wt.exe', chain: [{ pid: 30, name: 'WindowsTerminal.exe' }] }))
    s.watches[0].emit(shown({ hwnd: 7, pid: 31, cls: 'Notepad', chain: [{ pid: 31, name: 'notepad.exe' }] }))
    expect(s.lines.slice(1)).toEqual([
      'visible window (Host child): hwnd=5 pid=11 class=ConsoleWindowClass title="" chain=git.exe(11) <- astera-host.exe(1) cmd=git.exe status',
      'visible console window: hwnd=6 pid=30 class=CASCADIA_HOSTING_WINDOW_CLASS title="" chain=WindowsTerminal.exe(30) cmd=wt.exe'
    ])
  })

  it('logs the late title of a logged window when it says something new', async () => {
    const s = setup()
    await s.d.tick()
    s.watches[0].emit(shown({ hwnd: 6, cls: 'CASCADIA_HOSTING_WINDOW_CLASS', title: '' }))
    s.watches[0].emit(JSON.stringify({ kind: 'title', hwnd: 6, title: 'C:\\h\\astera-host.exe' }))
    s.watches[0].emit(JSON.stringify({ kind: 'title', hwnd: 99, title: 'not logged' }))
    expect(s.lines.at(-1)).toBe('visible window title: hwnd=6 title="C:\\\\h\\\\astera-host.exe"')
    expect(s.lines.some((l) => l.includes('not logged'))).toBe(false)
  })

  it('writes the summary every 10 minutes with the windows seen in it, then counts afresh', async () => {
    const s = setup()
    await s.d.tick()
    s.watches[0].emit(shown({ hwnd: 1 }))
    s.watches[0].emit(shown({ hwnd: 2 }))
    s.advance(WINDOW_DIAGNOSTIC_SUMMARY_MS - 1)
    await s.d.tick()
    expect(s.lines.some((l) => l.includes('seen in the last'))).toBe(false)
    s.advance(1)
    await s.d.tick()
    expect(s.lines.at(-1)).toBe('window diagnostic: 2 visible windows seen in the last 10 min')
    s.advance(WINDOW_DIAGNOSTIC_SUMMARY_MS)
    await s.d.tick()
    expect(s.lines.at(-1)).toBe('window diagnostic: 0 visible windows seen in the last 10 min')
  })

  it('stops the watcher when the setting goes off, and restarts one that exited at the next check', async () => {
    const s = setup()
    await s.d.tick()
    s.setEnabled(false)
    await s.d.tick()
    expect(s.watches[0].stopped).toBe(true)
    s.setEnabled(true)
    await s.d.tick()
    expect(s.watches).toHaveLength(2)
    s.watches[1].exit('it exited with 1')
    expect(s.lines.at(-1)).toMatch(/watcher stopped \(it exited with 1\)/)
    await s.d.tick()
    expect(s.watches).toHaveLength(3)
    s.d.stop()
    expect(s.watches[2].stopped).toBe(true)
  })

  it('does nothing off win32 and starts nothing with the setting off', async () => {
    const off = setup({ enabled: false })
    await off.d.tick()
    expect(off.watches).toEqual([])
    const linux = setup({ platform: 'linux' })
    await linux.d.tick()
    linux.d.start()
    expect(linux.watches).toEqual([])
    expect(linux.lines).toEqual([])
  })

  it('a watcher that cannot start is logged and does not throw', async () => {
    const lines: string[] = []
    const d = createWindowDiagnostic({
      platform: 'win32',
      hostPid: 1,
      enabled: async () => true,
      watch: () => {
        throw new Error('boom')
      },
      log: (m) => lines.push(m)
    })
    await d.tick()
    expect(lines).toEqual(['window diagnostic: the watcher failed: Error: boom'])
  })
})
