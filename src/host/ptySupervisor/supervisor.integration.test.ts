// The pty supervisor for real: a parent process (standing in for the Host) starts the real supervisor bundle and opens
// a real node-pty session through it; the parent is then killed hard, and the session must still be running with its
// output kept. Both bundles are built here with esbuild from the sources (node-pty stays external and loads from this
// repository's node_modules, through NODE_PATH).
import { describe, it, expect, afterAll } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createPtySupervisorClient, netLink } from './client'
import { SUPERVISOR_IDLE_ENV, supervisorAddress } from './protocol'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const tmp = mkdtempSync(path.join(os.tmpdir(), 'pty-supervisor-it-'))
const profileDir = path.join(tmp, 'profile')
// A Host's profile always exists; the supervisor runs in it.
mkdirSync(profileDir)
let ptyPid = 0

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

afterAll(() => {
  if (ptyPid && alive(ptyPid)) {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(ptyPid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else process.kill(ptyPid, 'SIGKILL')
  }
  // Best effort: a supervisor still leaving holds its folder on win32 (the suite's globalSetup sweeps stale ones).
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* left for the sweep */
  }
})

const PARENT = `
import { startPtySupervisor } from ${JSON.stringify(path.join(here, 'client.ts'))}
const [profileDir, entryPath] = process.argv.slice(2)
const client = startPtySupervisor({
  profileDir,
  execPath: process.execPath,
  entryPath,
  env: process.env,
  platform: process.platform,
  log: (m) => process.stderr.write(m + '\\n'),
  fallback: () => { throw new Error('fell back to the parent') }
})
const p = client.spawn(process.execPath, ['-e', "let i = 0; setInterval(() => console.log('tick ' + i++), 100)"], { cwd: profileDir, cols: 80, rows: 24, env: process.env }, { kind: 'session', id: 'it-1', restore: {} })
p.onData(() => {})
process.stdout.write(JSON.stringify({ pid: p.pid }) + '\\n')
setInterval(() => {}, 60_000)
`

describe('pty supervisor (real processes)', () => {
  it('keeps a pty alive and its output readable after the process that started it is killed', async () => {
    const common = { bundle: true, platform: 'node' as const, format: 'cjs' as const, target: 'node20', external: ['node-pty'], logLevel: 'silent' as const }
    const entry = path.join(tmp, 'pty-supervisor.js')
    const parentJs = path.join(tmp, 'parent.js')
    await build({ ...common, entryPoints: [path.join(here, 'entry.ts')], outfile: entry })
    await build({ ...common, stdin: { contents: PARENT, resolveDir: here, loader: 'ts' }, outfile: parentJs })

    const env = { ...process.env, NODE_PATH: path.join(repo, 'node_modules'), [SUPERVISOR_IDLE_ENV]: '1500' }
    const parent = spawn(process.execPath, [parentJs, profileDir, entry], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stderr = ''
    parent.stderr.on('data', (d) => (stderr += String(d)))
    const first = await new Promise<string>((resolve, reject) => {
      let out = ''
      parent.stdout.on('data', (d) => {
        out += String(d)
        if (out.includes('\n')) resolve(out.split('\n')[0])
      })
      parent.once('exit', (code) => reject(new Error(`the parent exited ${code}: ${stderr}`)))
    })
    ptyPid = (JSON.parse(first) as { pid: number }).pid
    expect(ptyPid).toBeGreaterThan(0)

    // The parent dies the hard way, as the Host did on 2026-11-01.
    const gone = new Promise((r) => parent.once('exit', r))
    parent.kill('SIGKILL')
    await gone
    await new Promise((r) => setTimeout(r, 1_000))
    expect(alive(ptyPid)).toBe(true)

    // A new Host finds it, reads what it wrote meanwhile, and ends it.
    const address = supervisorAddress(profileDir, process.platform)
    const c = createPtySupervisorClient({ link: netLink(address, Date.now() + 5_000, () => {}), request: () => 'unreachable', fallback: () => { throw new Error('no fallback here') }, log: () => {} })
    const held = (await c.list()).find((p) => p.pid === ptyPid)
    expect(held).toMatchObject({ alive: true, note: { kind: 'session', id: 'it-1' } })
    let out = ''
    const exited = new Promise<number>((resolve) => {
      const p = c.attach(held!.id, ptyPid)
      p.onData((d) => (out += d))
      p.onExit((e) => resolve(e.exitCode))
      void (async () => {
        for (let i = 0; i < 100 && !/tick \d+[\s\S]*tick \d+/.test(out); i++) await new Promise((r) => setTimeout(r, 100))
        p.kill()
      })()
    })
    await exited
    expect(out).toMatch(/tick \d+[\s\S]*tick \d+/)
    for (let i = 0; i < 50 && alive(ptyPid); i++) await new Promise((r) => setTimeout(r, 100))
    expect(alive(ptyPid)).toBe(false)

    // No pty and no Host: it leaves by itself (idle wait shortened for the test).
    c.close()
    const listening = (): Promise<boolean> =>
      new Promise((resolve) => {
        const s = net.connect(address)
        s.once('connect', () => {
          s.destroy()
          resolve(true)
        })
        s.once('error', () => resolve(false))
      })
    // Each probe is a connection, which counts as a Host and restarts the wait: probe seldom.
    let up = true
    for (let i = 0; i < 5 && up; i++) {
      await new Promise((r) => setTimeout(r, 3_000))
      up = await listening()
    }
    expect(up).toBe(false)
  }, 60_000)
})
