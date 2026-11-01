import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hostProcessDeps, stopProcessesIn, type StopInDeps } from './processesIn'
import { descendantsOf, queryWindowsProcesses, type ProcRow } from '../workerLeftovers'

const row = (pid: number, ppid: number, created: number, cmd = '', name = 'node.exe'): ProcRow => ({ pid, ppid, created, name, cmd, mem: 0 })

const DIR = 'C:\\Users\\me\\astera-worktrees\\app\\wt-a'

function fake(rows: ProcRow[], over: Partial<StopInDeps> = {}): { d: StopInDeps; stopped: number[][]; logs: string[] } {
  const stopped: number[][] = []
  const logs: string[] = []
  const d: StopInDeps = {
    platform: 'win32',
    hostPid: 10,
    liveRoots: () => [20],
    list: async () => rows,
    stop: async (r) => {
      stopped.push(r.map((x) => x.pid).sort((a, b) => a - b))
    },
    log: (m) => logs.push(m),
    ...over
  }
  return { d, stopped, logs }
}

describe('stopProcessesIn', () => {
  const table = [
    row(1, 0, 1, 'C:\\Windows\\explorer.exe', 'explorer.exe'),
    // the app (started from the folder) with another child of its own, and the Host naming the folder too
    row(5, 1, 50, `Astera.exe ${DIR}`, 'Astera.exe'),
    row(6, 5, 60, 'Astera.exe --type=renderer', 'Astera.exe'),
    row(10, 5, 100, `node host.js --cwd ${DIR}`),
    // a live session elsewhere and a tool of it that names the folder
    row(20, 10, 200, 'claude.exe', 'claude.exe'),
    row(21, 20, 210, `git -C ${DIR} status`, 'git.exe'),
    // what a worker left: a server naming the folder in another case and slash, under a live parent, and its child
    row(30, 1, 300, 'cmd.exe /c npm run dev', 'cmd.exe'),
    row(31, 30, 310, 'node c:/users/ME/astera-worktrees/app/wt-a/node_modules/.bin/storybook dev -p 6006'),
    row(32, 31, 320, 'esbuild.exe --service', 'esbuild.exe'),
    // a sibling folder whose name only starts the same, and a folder elsewhere
    row(40, 1, 400, `node ${DIR}b\\server.js`),
    row(41, 1, 410, 'node D:\\other\\server.js')
  ]

  it('stops what names the folder (any case, either slash) with what it started, never the Host, the app, a live session or another folder', async () => {
    const { d, stopped, logs } = fake(table)
    const r = await stopProcessesIn(DIR, d)
    expect(r.map((x) => x.pid).sort((a, b) => a - b)).toEqual([31, 32])
    expect(stopped).toEqual([[31, 32]])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain(DIR)
  })

  it("stops what was recorded under a session that ran there, still alive with the same creation time, not a pid reused since", async () => {
    // The api.exe a `go run` left: nothing on its command line names the folder, and its parent is gone.
    const rows = [...table, row(50, 49, 500, 'api.exe', 'api.exe'), row(51, 50, 510, 'api-child.exe'), row(60, 1, 999, 'notepad.exe', 'notepad.exe')]
    const seen: string[] = []
    const { d, stopped } = fake(rows, {
      remembered: (dir) => {
        seen.push(dir)
        return [
          { pid: 50, created: 500 },
          // pid 60 was the session's once; it now belongs to a process made later
          { pid: 60, created: 600 }
        ]
      }
    })
    await stopProcessesIn(DIR, d)
    expect(seen).toEqual([DIR])
    expect(stopped).toEqual([[31, 32, 50, 51]])
  })

  it('stops nothing and never rejects when the processes or the live sessions cannot be read', async () => {
    const a = fake(table, { list: async () => { throw new Error('powershell timed out') } })
    await expect(stopProcessesIn(DIR, a.d)).resolves.toEqual([])
    expect(a.stopped).toEqual([])
    expect(a.logs[0]).toContain('powershell timed out')
    const b = fake(table, { liveRoots: () => { throw new Error('not listed') } })
    await expect(stopProcessesIn(DIR, b.d)).resolves.toEqual([])
    expect(b.stopped).toEqual([])
  })

  it('stops nothing and writes no line when nothing runs there', async () => {
    const { d, stopped, logs } = fake(table)
    expect(await stopProcessesIn('C:\\Users\\me\\astera-worktrees\\app\\wt-z', d)).toEqual([])
    expect(stopped).toEqual([])
    expect(logs).toEqual([])
  })

  // The real machine: a short-lived parent starts a node child with its cwd in a temp folder, its tree is
  // recorded while the parent lives, the parent ends, and the orphan is stopped by the folder's removal step.
  it.runIf(process.platform === 'win32')('ends an orphaned node child whose cwd is in the folder (Windows)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-procin-'))
    const script =
      "const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], " +
      `{ cwd: ${JSON.stringify(dir)}, detached: true, stdio: 'ignore', windowsHide: true }); c.unref(); console.log(c.pid); setInterval(() => {}, 1000)`
    const parent = spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let child = 0
    try {
      child = await new Promise<number>((resolve, reject) => {
        parent.stdout.once('data', (b: Buffer) => resolve(Number(String(b).trim())))
        parent.once('error', reject)
      })
      const recorded = descendantsOf(await queryWindowsProcesses(), [parent.pid!]).map((r) => ({ pid: r.pid, created: r.created }))
      expect(recorded.map((r) => r.pid)).toContain(child)
      parent.kill()
      await new Promise((r) => parent.once('exit', r))
      expect(() => process.kill(child, 0)).not.toThrow()

      const logs: string[] = []
      const stopped = await stopProcessesIn(dir, { ...hostProcessDeps({ liveRoots: () => [], log: (m) => logs.push(m) }), remembered: () => recorded })
      expect(stopped.map((r) => r.pid)).toContain(child)
      expect(() => process.kill(child, 0)).toThrow()
    } finally {
      parent.kill()
      try {
        if (child) process.kill(child)
      } catch {
        // already gone
      }
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }, 60_000)
})
