import { describe, it, expect } from 'vitest'
import {
  createLeftoverTracker,
  descendantsOf,
  freedLine,
  leftoverDispatchesOf,
  LEFTOVER_RECENT_MS,
  namesWorktree,
  parseLinuxStat,
  parseWindowsRows,
  procLabel,
  queryWindowsProcesses,
  readLinuxProcesses,
  stopProcesses,
  toStop,
  LINUX_TERM_GRACE_MS,
  type LeftoverDispatch,
  type ProcRow
} from './workerLeftovers'

// T16: what a worker leaves running (dev servers, browsers) is stopped when its Dispatch ends, found by its
// remembered descendant tree (pid + creation time) and by its worktree path. Every process here is a fake.

const GB = 1024 ** 3
const row = (pid: number, ppid: number, created: number, name = 'node.exe', cmd = '', mem = 0): ProcRow => ({ pid, ppid, created, name, cmd, mem })

const HOST = 100
const WT = 'C:\\Users\\Jonx\\astera-worktrees\\Astera\\T16'

/** The Host (100) under the app (50); a worker session pty (200) and an owner's tab (300) under the Host. */
const base = (): ProcRow[] => [
  row(50, 1, 1_000, 'Astera.exe', '"C:\\Program Files\\Astera\\Astera.exe"'),
  row(HOST, 50, 2_000, 'astera-host.exe'),
  row(200, HOST, 10_000, 'cmd.exe', '/c call claude.cmd'),
  row(201, 200, 10_100, 'claude.exe'),
  row(300, HOST, 11_000, 'pwsh.exe')
]

describe('parseWindowsRows', () => {
  it('reads the JSON array the CIM query writes, and drops rows that do not hold together', () => {
    const out = JSON.stringify([
      { p: 4242, pp: 200, c: 1_700_000_000_000, n: 'node.exe', cl: `node ${WT}\\node_modules\\.bin\\storybook dev`, m: 2.7 * GB },
      { p: 'x', pp: 1, c: 1 },
      { p: 7, pp: 1, c: 0 },
      { p: 8, pp: 1, c: 1_700_000_000_001, n: 'firefox.exe', cl: null, m: null }
    ])
    expect(parseWindowsRows(out)).toEqual([
      row(4242, 200, 1_700_000_000_000, 'node.exe', `node ${WT}\\node_modules\\.bin\\storybook dev`, 2.7 * GB),
      row(8, 1, 1_700_000_000_001, 'firefox.exe', '', 0)
    ])
  })

  it('reads a lone object (PowerShell unwraps a one-row array) and JSON lines', () => {
    expect(parseWindowsRows('{"p":9,"pp":1,"c":5,"n":"bun.exe","cl":"bun dev","m":10}')).toEqual([row(9, 1, 5, 'bun.exe', 'bun dev', 10)])
    expect(parseWindowsRows('{"p":9,"pp":1,"c":5}\r\nnot json\r\n{"p":10,"pp":9,"c":6}').map((r) => r.pid)).toEqual([9, 10])
    expect(parseWindowsRows('   ')).toEqual([])
  })
})

describe('parseLinuxStat', () => {
  it('counts the fields from the last parenthesis, so a comm with spaces and parentheses reads', () => {
    // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime
    // priority nice threads itrealvalue starttime vsize rss
    const stat = '4321 (Web Content (x)) S 4000 4321 4321 0 -1 4194304 1 0 0 0 5 3 0 0 20 0 30 0 987654 100000 2500 18446744073709551615'
    expect(parseLinuxStat(stat, 'firefox\0-contentproc\0/home/u/wt\0')).toEqual(row(4321, 4000, 987654, 'Web Content (x)', 'firefox -contentproc /home/u/wt', 2500 * 4096))
    expect(parseLinuxStat('garbage')).toBeNull()
  })

  it('reads every process under /proc and skips one that ends while it is read', async () => {
    const files: Record<string, string> = {
      '/proc/10/stat': '10 (node) S 1 10 10 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 500 0 10',
      '/proc/10/cmdline': 'node\0server.js\0'
    }
    const rows = await readLinuxProcesses({
      readdir: async () => ['10', '11', 'self', 'meminfo'],
      readFile: async (p) => {
        if (p in files) return files[p]
        throw new Error('ENOENT')
      }
    })
    expect(rows).toEqual([row(10, 1, 500, 'node', 'node server.js', 40960)])
  })
})

describe('descendantsOf', () => {
  it('walks the tree under a root, leaving the root out', () => {
    const rows = [...base(), row(400, 201, 20_000, 'bash.exe'), row(401, 400, 20_100, 'node.exe')]
    expect(descendantsOf(rows, [200]).map((r) => r.pid).sort()).toEqual([201, 400, 401])
  })

  it('does not take a process older than the pid it names as parent (the pid was reused)', () => {
    // 500 is older than the process now holding 201: its real parent was an earlier 201.
    const rows = [...base(), row(500, 201, 9_000, 'node.exe')]
    expect(descendantsOf(rows, [200]).map((r) => r.pid)).toEqual([201])
  })

  it("follows a dead root's children by its creation time, and not the children of a new holder of its pid", () => {
    const orphan = row(600, 555, 30_100, 'node.exe', 'storybook dev')
    // 555 died; its pid now belongs to 555' (made at 40 000) whose child 601 is someone else's.
    const rows = [...base(), orphan, row(555, 1, 40_000, 'svchost.exe'), row(601, 555, 40_100, 'conhost.exe')]
    expect(descendantsOf(rows, [{ pid: 555, created: 30_000 }]).map((r) => r.pid)).toEqual([600])
  })
})

describe('namesWorktree', () => {
  it('matches backslashes, forward slashes and the drive letter in any case on Windows', () => {
    expect(namesWorktree(`node ${WT}\\node_modules\\vite\\bin\\vite.js`, WT, 'win32')).toBe(true)
    expect(namesWorktree('node c:/users/jonx/astera-worktrees/astera/t16/server.js', WT, 'win32')).toBe(true)
    expect(namesWorktree(`firefox.exe -profile "${WT.toUpperCase()}\\.tmp-profile"`, WT, 'win32')).toBe(true)
    expect(namesWorktree(`node ${WT}`, `${WT}\\`, 'win32')).toBe(true)
    // Git Bash writes the same folder as /c/…
    expect(namesWorktree('node /c/Users/Jonx/astera-worktrees/Astera/T16/server.js', WT, 'win32')).toBe(true)
  })

  it('does not match a sibling folder whose name only starts the same', () => {
    expect(namesWorktree(`node ${WT}-other\\server.js`, WT, 'win32')).toBe(false)
    expect(namesWorktree(`node ${WT}2\\server.js`, WT, 'win32')).toBe(false)
    expect(namesWorktree('node D:/c/Users/Jonx/astera-worktrees/Astera/T16/x.js', WT, 'win32')).toBe(false)
  })

  it('compares exactly on Linux', () => {
    expect(namesWorktree('node /home/u/wt/T16/server.js', '/home/u/wt/T16', 'linux')).toBe(true)
    expect(namesWorktree('node /home/u/wt/t16/server.js', '/home/u/wt/T16', 'linux')).toBe(false)
  })
})

describe('toStop', () => {
  const guard = { liveRoots: [300], hostPid: HOST }

  it('stops the remembered descendants still alive with the same pid and creation time', () => {
    // The worker's session (200, 201) is gone; storybook 700 and its child 701 were remembered.
    const rows = [row(50, 1, 1_000, 'Astera.exe'), row(HOST, 50, 2_000), row(300, HOST, 11_000, 'pwsh.exe'), row(700, 4, 12_000, 'node.exe', 'storybook'), row(701, 700, 12_100)]
    const stop = toStop([{ pid: 700, created: 12_000 }], rows, null, 'win32', guard)
    expect(stop.map((r) => r.pid).sort()).toEqual([700, 701])
  })

  it('does not stop a reused pid, which has another creation time', () => {
    const rows = [row(HOST, 50, 2_000), row(700, 4, 99_000, 'node.exe', 'someone else')]
    expect(toStop([{ pid: 700, created: 12_000 }], rows, null, 'win32', guard)).toEqual([])
  })

  it('stops orphans whose command line names the worktree, with either slash and any drive-letter case', () => {
    const rows = [
      row(HOST, 50, 2_000),
      row(800, 7777, 13_000, 'node.exe', `node ${WT}\\node_modules\\.bin\\storybook dev`),
      row(801, 7778, 13_000, 'chrome.exe', 'chrome --headless --user-data-dir=c:/users/jonx/astera-worktrees/astera/t16/.cache'),
      row(802, 801, 13_100, 'chrome.exe', '--type=renderer')
    ]
    expect(toStop([], rows, WT, 'win32', guard).map((r) => r.pid).sort()).toEqual([800, 801, 802])
  })

  it("leaves a worktree process alone when its live parent is not the worker's (an editor, a service)", () => {
    const rows = [row(HOST, 50, 2_000), row(900, 1, 500, 'explorer.exe'), row(901, 900, 14_000, 'Code.exe', `Code.exe ${WT}`)]
    expect(toStop([], rows, WT, 'win32', guard)).toEqual([])
  })

  it("never stops the owner's tab, another session, the Host or the app, even when they name the worktree", () => {
    const rows = [
      row(50, 1, 1_000, 'Astera.exe', `Astera.exe ${WT}`),
      row(HOST, 50, 2_000, 'astera-host.exe', `astera-host ${WT}`),
      row(300, HOST, 11_000, 'pwsh.exe'),
      row(310, 300, 15_000, 'node.exe', `node ${WT}\\server.js`),
      row(320, HOST, 11_500, 'cmd.exe'),
      row(321, 320, 15_500, 'node.exe', `node ${WT}\\dev.js`)
    ]
    // 310 runs in the owner's tab (300); 321 under another live session (320); a remembered pid that is
    // now under the owner's tab is shielded too.
    expect(toStop([{ pid: 310, created: 15_000 }], rows, WT, 'win32', { liveRoots: [300, 320], hostPid: HOST })).toEqual([])
  })

  it('does not stop a worktree process made before the Dispatch started', () => {
    const rows = [row(HOST, 50, 2_000), row(800, 7777, 13_000, 'node.exe', `node ${WT}\\server.js`)]
    expect(toStop([], rows, WT, 'win32', { ...guard, since: 20_000 })).toEqual([])
  })

  it('reads Linux rows: an orphan handed to init that names the worktree is stopped, one under a live parent is not', () => {
    const wt = '/home/u/astera-worktrees/T16'
    const rows = [
      row(1, 0, 1, 'systemd'),
      row(HOST, 1, 100, 'astera-host'),
      row(300, HOST, 200, 'bash'),
      row(1000, 1, 300, 'node', `node ${wt}/node_modules/.bin/vite`),
      row(1001, 1000, 310, 'esbuild', 'esbuild --service'),
      row(1100, 300, 400, 'node', `node ${wt}/server.js`)
    ]
    expect(toStop([], rows, wt, 'linux', guard).map((r) => r.pid).sort()).toEqual([1000, 1001])
  })
})

describe('the activity line', () => {
  it('names the processes, groups repeats and sums the memory', () => {
    const stopped = [
      row(1, 0, 1, 'node.exe', `"C:\\nodejs\\node.exe" ${WT}\\node_modules\\storybook\\bin\\index.cjs dev -p 6006`, 2.7 * GB),
      row(2, 0, 1, 'firefox.exe', '', 1 * GB),
      row(3, 0, 1, 'firefox.exe', '', 0.4 * GB)
    ]
    expect(freedLine('T16', stopped)).toBe('Freed 3 processes worker T16 left running: firefox ×2, node (storybook), 4.1 GB')
    expect(freedLine('T16', [row(4, 0, 1, 'bun.exe', 'bun run dev', 50 * 1024 ** 2)])).toBe('Freed 1 process worker T16 left running: bun, 50 MB')
  })

  it('names a node script when no package is in the command line', () => {
    expect(procLabel({ name: 'node.exe', cmd: 'node C:\\wt\\scripts\\serve.mjs --port 3000' })).toBe('node (serve.mjs)')
    expect(procLabel({ name: 'node', cmd: 'node /wt/node_modules/@storybook/cli/bin/index.js' })).toBe('node (@storybook/cli)')
  })
})

describe('createLeftoverTracker', () => {
  const rig = (o: { rows?: () => ProcRow[]; list?: () => Promise<ProcRow[]>; stop?: (r: ProcRow[]) => Promise<void>; freed?: () => void } = {}) => {
    let rows = o.rows ?? base
    const dispatches: LeftoverDispatch[] = []
    const pids = new Map<string, number>([['ses_w', 200]])
    const lists: number[] = []
    const stopped: number[][] = []
    const freed: Array<[string, string]> = []
    const logs: string[] = []
    const timers: Array<{ ms: number; fn: () => void }> = []
    const t = createLeftoverTracker({
      platform: 'win32',
      hostPid: HOST,
      dispatches: () => dispatches,
      sessionPid: (s) => pids.get(s) ?? null,
      liveRoots: () => [...pids.values(), 300],
      list: async () => {
        lists.push(1)
        return o.list ? o.list() : rows()
      },
      stop: async (r) => {
        if (o.stop) return o.stop(r)
        stopped.push(r.map((x) => x.pid).sort((a, b) => a - b))
      },
      freed: (id, line) => {
        o.freed?.()
        freed.push([id, line])
      },
      log: (m) => logs.push(m),
      every: () => () => {},
      after: (ms, fn) => {
        timers.push({ ms, fn })
        return () => {}
      }
    })
    const add = (x: Partial<LeftoverDispatch> & { dispatchId: string }): LeftoverDispatch => {
      const full: LeftoverDispatch = { sessionId: 'ses_w', worktree: WT, closed: false, keep: false, label: 'T16', ...x }
      dispatches.push(full)
      return full
    }
    return { t, add, pids, lists, stopped, freed, logs, timers, setRows: (r: () => ProcRow[]) => (rows = r) }
  }

  /** The worker (200) has started storybook through `start`: cmd 210 -> node 211 -> esbuild 212. */
  const working = (): ProcRow[] => [...base(), row(210, 201, 20_000, 'cmd.exe'), row(211, 210, 20_100, 'node.exe', 'storybook dev', 2 * GB), row(212, 211, 20_200, 'esbuild.exe')]
  /** The session ended: 200, 201 and 210 are gone, 211 and 212 survived. */
  const after = (): ProcRow[] => [row(50, 1, 1_000, 'Astera.exe'), row(HOST, 50, 2_000), row(300, HOST, 11_000, 'pwsh.exe'), row(211, 210, 20_100, 'node.exe', 'storybook dev', 2 * GB), row(212, 211, 20_200, 'esbuild.exe')]

  it("remembers every live worker's descendants by pid and creation time from one query", async () => {
    const r = rig({ rows: working })
    r.pids.set('ses_x', 300 /* any live pty */)
    r.add({ dispatchId: 'dsp_1' })
    r.add({ dispatchId: 'dsp_2', sessionId: 'ses_x' })
    await r.t.tick()
    expect(r.lists).toHaveLength(1)
    expect(r.t.rememberedOf('dsp_1').map((p) => p.pid).sort()).toEqual([201, 210, 211, 212])
    expect(r.t.rememberedOf('dsp_1').find((p) => p.pid === 211)?.created).toBe(20_100)
  })

  it('does not query at all while no worker is alive and nothing is due', async () => {
    const r = rig()
    r.pids.clear()
    r.add({ dispatchId: 'dsp_1' })
    await r.t.tick()
    expect(r.lists).toHaveLength(0)
  })

  it('stops what the worker left once its Dispatch closed and its session is gone, once, with one activity line', async () => {
    const r = rig({ rows: working })
    const d = r.add({ dispatchId: 'dsp_1' })
    await r.t.tick()
    // worker_done: the Dispatch closes while the session still lives: nothing is stopped yet.
    d.closed = true
    await r.t.tick()
    expect(r.stopped).toEqual([])
    // The release ends the session.
    r.pids.delete('ses_w')
    r.setRows(after)
    r.t.sessionEnded('ses_w')
    expect(r.timers).toHaveLength(1)
    r.timers[0].fn()
    await r.t.tick()
    expect(r.stopped).toEqual([[211, 212]])
    expect(r.freed).toEqual([['dsp_1', 'Freed 2 processes worker T16 left running: esbuild, node, 2.0 GB']])
    await r.t.tick()
    expect(r.stopped).toHaveLength(1)
  })

  it('leaves a retained or abandoned Dispatch alone', async () => {
    const r = rig({ rows: working })
    const d = r.add({ dispatchId: 'dsp_1' })
    await r.t.tick()
    d.closed = true
    d.keep = true
    r.pids.delete('ses_w')
    r.setRows(after)
    await r.t.tick()
    expect(r.stopped).toEqual([])
  })

  it('a failure while freeing is logged and never rejects, so it cannot block the close', async () => {
    for (const o of [
      { list: () => Promise.reject(new Error('powershell timed out')) },
      { stop: () => Promise.reject(new Error('access denied')) },
      {
        freed: () => {
          throw new Error('feed closed')
        }
      }
    ]) {
      let first = true
      const r = rig({
        ...o,
        rows: working,
        list: o.list
          ? () => {
              if (first) {
                first = false
                return Promise.resolve(working())
              }
              return o.list()
            }
          : undefined
      })
      const d = r.add({ dispatchId: 'dsp_1' })
      await r.t.tick()
      d.closed = true
      r.pids.delete('ses_w')
      r.setRows(after)
      await expect(r.t.tick()).resolves.toBeUndefined()
      expect(r.logs.some((m) => /failed|could not/.test(m))).toBe(true)
    }
  })

  it('freeFor on an unknown Dispatch, and sessionEnded on an unknown session, do nothing', async () => {
    const r = rig()
    await expect(r.t.freeFor('dsp_none')).resolves.toBe(0)
    expect(() => r.t.sessionEnded('ses_none')).not.toThrow()
    expect(r.timers).toHaveLength(0)
  })
})

describe('stopProcesses', () => {
  it('Windows: one hidden taskkill /T /F per process, and a failure does not stop the rest', async () => {
    const killed: number[] = []
    const logs: string[] = []
    await stopProcesses([row(1, 0, 1), row(2, 0, 1)], {
      platform: 'win32',
      log: (m) => logs.push(m),
      taskkill: async (pid) => {
        killed.push(pid)
        if (pid === 1) throw new Error('denied')
      }
    })
    expect(killed).toEqual([1, 2])
    expect(logs).toHaveLength(1)
  })

  it('Linux: SIGTERM, then SIGKILL after the grace only to a pid still holding the same start time', async () => {
    const sent: Array<[number, string]> = []
    const waited: number[] = []
    await stopProcesses([row(10, 1, 500), row(11, 1, 600), row(12, 1, 700)], {
      platform: 'linux',
      log: () => {},
      signal: (pid, sig) => {
        if (pid === 12) throw new Error('ESRCH')
        sent.push([pid, sig])
      },
      startTimeOf: async (pid) => (pid === 10 ? 500 : 999),
      wait: async (ms) => {
        waited.push(ms)
      }
    })
    expect(waited).toEqual([LINUX_TERM_GRACE_MS])
    expect(sent).toEqual([
      [10, 'SIGTERM'],
      [11, 'SIGTERM'],
      [10, 'SIGKILL']
    ])
  })
})

describe('queryWindowsProcesses', () => {
  it('asks one hidden Windows PowerShell for every Win32_Process and parses its answer', async () => {
    const calls: Array<[string, string[]]> = []
    const rows = await queryWindowsProcesses(async (file, args) => {
      calls.push([file, args])
      return '[{"p":5,"pp":4,"c":10,"n":"node.exe","cl":"node","m":1}]'
    })
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('powershell.exe')
    expect(calls[0][1].at(-1)).toMatch(/Get-CimInstance Win32_Process/)
    expect(calls[0][1].at(-1)).toMatch(/CommandLine/)
    expect(rows).toEqual([row(5, 4, 10, 'node.exe', 'node', 1)])
  })
})

describe('leftoverDispatchesOf', () => {
  const NOW = Date.parse('2026-10-31T12:00:00Z')
  const dispatch = (o: Record<string, unknown>) =>
    ({ id: 'dsp_1', taskId: 'tsk_1', sessionId: 'ses_w', cwd: WT, startedAt: '2026-10-31T11:00:00Z', retained: false, ...o }) as never

  it('hands over open and recently ended Dispatches, with the worktree only when it is one, and keep for retained or abandoned', () => {
    const s = {
      tasks: [{ id: 'tsk_1', title: 'Free what workers leave running' }] as never[],
      dispatches: [
        dispatch({}),
        dispatch({ id: 'dsp_2', cwd: 'C:\dev\Astera', outcome: 'succeeded', endedAt: '2026-10-31T11:30:00Z' }),
        dispatch({ id: 'dsp_3', endedAt: new Date(NOW - LEFTOVER_RECENT_MS - 1).toISOString() }),
        dispatch({ id: 'dsp_4', retained: true }),
        dispatch({ id: 'dsp_5', closedBy: 'abandon', endedAt: '2026-10-31T11:59:00Z' })
      ]
    }
    const out = leftoverDispatchesOf(s, NOW, 'win32', (p) => p === WT)
    expect(out.map((x) => x.dispatchId)).toEqual(['dsp_1', 'dsp_2', 'dsp_4', 'dsp_5'])
    expect(out[0]).toEqual({ dispatchId: 'dsp_1', sessionId: 'ses_w', worktree: WT, since: Date.parse('2026-10-31T11:00:00Z'), closed: false, keep: false, label: '"Free what workers leave running"' })
    expect(out[1]).toMatchObject({ worktree: null, closed: true, keep: false })
    expect(out[2].keep).toBe(true)
    expect(out[3].keep).toBe(true)
    // Linux counts creation in ticks since boot: no ISO lower bound there.
    expect(leftoverDispatchesOf(s, NOW, 'linux', () => true)[0].since).toBeUndefined()
  })
})
