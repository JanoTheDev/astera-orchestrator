// The Windows window diagnostic: a fake process table in, log lines out. Nothing here starts a process.
import { describe, expect, it } from 'vitest'
import {
  WINDOW_DIAGNOSTIC_ENV,
  WINDOW_DIAGNOSTIC_SUMMARY_MS,
  createWindowDiagnostic,
  descendantsOf,
  parseProcessTable,
  queryWindowTable
} from './windowDiagnostic'

const row = (pid: number, parent: number, o: Partial<{ name: string; cmd: string; created: number; window: boolean }> = {}) => ({
  ProcessId: pid,
  ParentProcessId: parent,
  Name: o.name ?? `p${pid}.exe`,
  CommandLine: o.cmd ?? `p${pid}.exe --arg`,
  Created: o.created ?? 1000,
  HasWindow: o.window ?? false
})

describe('parseProcessTable', () => {
  it('reads an array, a single object and empty output', () => {
    expect(parseProcessTable(JSON.stringify([row(2, 1), row(3, 2)]))).toHaveLength(2)
    expect(parseProcessTable(JSON.stringify(row(2, 1)))).toEqual([{ pid: 2, parent: 1, name: 'p2.exe', cmd: 'p2.exe --arg', created: 1000, window: false }])
    expect(parseProcessTable('')).toEqual([])
    expect(parseProcessTable('not json')).toEqual([])
  })

  it('drops rows without a usable pid and keeps a missing command line empty', () => {
    const t = parseProcessTable(JSON.stringify([{ ProcessId: 'x' }, { ProcessId: 5, ParentProcessId: 1, Name: 'a.exe', Created: 7, HasWindow: true }]))
    expect(t).toEqual([{ pid: 5, parent: 1, name: 'a.exe', cmd: '', created: 7, window: true }])
  })
})

describe('descendantsOf', () => {
  it('finds children transitively, not the root nor strangers, and survives a parent cycle', () => {
    const t = parseProcessTable(JSON.stringify([row(10, 1), row(11, 10), row(12, 11), row(20, 2), row(1, 12)]))
    expect(descendantsOf(t, 1).map((p) => p.pid).sort()).toEqual([10, 11, 12])
  })
})

describe('createWindowDiagnostic', () => {
  function setup(o: { platform?: NodeJS.Platform; enabled?: boolean } = {}) {
    let clock = 0
    let enabled = o.enabled ?? true
    let table: unknown[] = []
    const queries: number[] = []
    const lines: string[] = []
    const d = createWindowDiagnostic({
      platform: o.platform ?? 'win32',
      hostPid: 1,
      enabled: async () => enabled,
      query: async (pid) => {
        queries.push(pid)
        return JSON.stringify(table)
      },
      log: (m) => lines.push(m),
      now: () => clock
    })
    return {
      d,
      lines,
      queries,
      setTable: (t: unknown[]) => (table = t),
      setEnabled: (v: boolean) => (enabled = v),
      advance: (ms: number) => (clock += ms)
    }
  }

  it('logs only descendants that own a window, with image, parent and command line', async () => {
    const s = setup()
    s.setTable([row(10, 1), row(11, 10, { window: true, name: 'cmd.exe', cmd: 'cmd.exe /c dir' }), row(30, 2, { window: true })])
    await s.d.tick()
    expect(s.lines).toEqual(['visible window: pid=11 image=cmd.exe parent=10 cmd=cmd.exe /c dir'])
  })

  it('cuts the command line at 500 characters', async () => {
    const s = setup()
    s.setTable([row(10, 1, { window: true, cmd: 'x'.repeat(900) })])
    await s.d.tick()
    expect(s.lines[0]).toBe(`visible window: pid=10 image=p10.exe parent=1 cmd=${'x'.repeat(500)}`)
  })

  it('logs each pid and creation time once; a reused pid with a new creation time is logged again', async () => {
    const s = setup()
    s.setTable([row(10, 1, { window: true, created: 5 })])
    await s.d.tick()
    await s.d.tick()
    expect(s.lines).toHaveLength(1)
    s.setTable([row(10, 1, { window: true, created: 9 })])
    await s.d.tick()
    expect(s.lines).toHaveLength(2)
  })

  it('writes the summary every 10 minutes with the windows seen in it, then counts afresh', async () => {
    const s = setup()
    s.setTable([row(10, 1, { window: true }), row(11, 1, { window: true })])
    await s.d.tick()
    s.advance(WINDOW_DIAGNOSTIC_SUMMARY_MS - 1)
    await s.d.tick()
    expect(s.lines.some((l) => l.startsWith('window diagnostic:'))).toBe(false)
    s.advance(1)
    await s.d.tick()
    expect(s.lines.at(-1)).toBe('window diagnostic: 2 visible windows seen in the last 10 min')
    s.setTable([])
    s.advance(WINDOW_DIAGNOSTIC_SUMMARY_MS)
    await s.d.tick()
    expect(s.lines.at(-1)).toBe('window diagnostic: 0 visible windows seen in the last 10 min')
  })

  it('does nothing off win32 and queries nothing with the setting off', async () => {
    const off = setup({ enabled: false })
    off.setTable([row(10, 1, { window: true })])
    await off.d.tick()
    expect(off.queries).toEqual([])
    const linux = setup({ platform: 'linux' })
    linux.setTable([row(10, 1, { window: true })])
    await linux.d.tick()
    linux.d.start()
    expect(linux.queries).toEqual([])
    expect(linux.lines).toEqual([])
  })

  it('a failing query is logged once per tick and does not throw', async () => {
    const lines: string[] = []
    const d = createWindowDiagnostic({
      platform: 'win32',
      hostPid: 1,
      enabled: async () => true,
      query: async () => {
        throw new Error('boom')
      },
      log: (m) => lines.push(m)
    })
    await d.tick()
    expect(lines).toEqual(['window diagnostic: the query failed: Error: boom'])
  })
})

describe('queryWindowTable', () => {
  it('runs a hidden powershell, with the Host pid in the environment and not on the command line', async () => {
    let seen: { file: string; args: string[]; env: Record<string, string | undefined>; hide: boolean | undefined } | null = null
    const out = await queryWindowTable(4242, async (file, args, opts) => {
      seen = { file, args, env: opts.env, hide: opts.windowsHide }
      return '[]'
    })
    expect(out).toBe('[]')
    expect(seen!.file).toBe('powershell.exe')
    expect(seen!.hide).toBe(true)
    expect(seen!.env[WINDOW_DIAGNOSTIC_ENV]).toBe('4242')
    expect(seen!.args.join(' ')).not.toContain('4242')
  })

  it('refuses a pid that is not a pid', async () => {
    await expect(queryWindowTable(0, async () => '')).rejects.toThrow(/not a pid/)
  })
})
