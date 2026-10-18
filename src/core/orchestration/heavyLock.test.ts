// W8-C heavy: the machine-wide heavy-job slot. Real `flock` and real child processes, on a temp lock and queue dir
// (never /tmp/astera-fullsuite.lock: another tab's real full suite may hold it).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { heavyQueue, heavyWaits, runHeavy } from './heavyLock'

let dir: string
let lock: string
let queueDir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astera-heavy-'))
  lock = path.join(dir, 'test.lock')
  queueDir = path.join(dir, 'queue')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const run = (argv: string[], sessionId?: string): Promise<number> =>
  runHeavy({ argv, env: process.env, cwd: dir, lock, queueDir, pollMs: 50, stdio: 'ignore', sessionId, err: () => {} })

/** A `node -e` that logs its start and end to `out`, holding the slot for `ms`. */
const step = (out: string, name: string, ms = 150): string[] => [
  '--',
  process.execPath,
  '-e',
  `const fs=require('fs');fs.appendFileSync(${JSON.stringify(out)},'start ${name}\\n');setTimeout(()=>fs.appendFileSync(${JSON.stringify(out)},'end ${name}\\n'),${ms})`
]

const deadPid = (): number => spawnSync(process.execPath, ['-e', '']).pid!

const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 25))
}

describe('runHeavy', () => {
  it('runs three concurrent callers one at a time, in arrival order', async () => {
    const out = path.join(dir, 'log')
    const codes = await Promise.all([run(step(out, 'A')), run(step(out, 'B')), run(step(out, 'C'))])
    expect(codes).toEqual([0, 0, 0])
    expect(readFileSync(out, 'utf8').trim().split('\n')).toEqual(['start A', 'end A', 'start B', 'end B', 'start C', 'end C'])
    expect(heavyQueue(queueDir)).toEqual([])
  })

  it('skips the ticket of a waiter that crashed', async () => {
    mkdirSync(queueDir, { recursive: true })
    writeFileSync(path.join(queueDir, `${'0'.repeat(20)}-dead.json`), JSON.stringify({ pid: deadPid(), cmd: 'x', cwd: dir, at: 0 }))
    expect(await run(['--', process.execPath, '-e', 'process.exit(0)'])).toBe(0)
    expect(existsSync(path.join(queueDir, `${'0'.repeat(20)}-dead.json`))).toBe(false)
  })

  it('passes the exit code through', async () => {
    expect(await run(['--', process.execPath, '-e', 'process.exit(7)'])).toBe(7)
  })

  it('releases the slot when the holder is killed, and the next caller runs', async () => {
    const pidFile = path.join(dir, 'pid')
    const holder = run(['--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`])
    const next = run(['--', process.execPath, '-e', 'process.exit(0)'])
    await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '')
    process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL')
    expect(await holder).toBe(128 + 9)
    expect(await next).toBe(0)
    // A hand-opened tab's `flock -n` gets the lock at once.
    expect(spawnSync('flock', ['-n', lock, 'true']).status).toBe(0)
  })

  it('shares the slot with a hand-opened tab that holds the same lock with flock', async () => {
    const out = path.join(dir, 'log')
    const hand = spawn('flock', [lock, process.execPath, '-e', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(out)},'start hand\\n');setTimeout(()=>fs.appendFileSync(${JSON.stringify(out)},'end hand\\n'),300)`])
    const handDone = new Promise((r) => hand.on('exit', r))
    await until(() => existsSync(out))
    expect(await run(step(out, 'heavy', 10))).toBe(0)
    await handDone
    expect(readFileSync(out, 'utf8').trim().split('\n')).toEqual(['start hand', 'end hand', 'start heavy', 'end heavy'])
  })

  it('refuses a call without a command', async () => {
    expect(await run(['--'])).toBe(2)
    expect(await run([])).toBe(2)
    expect(await run(['--help'])).toBe(0)
  })
})

describe('heavyWaits', () => {
  it('gives each waiting session its place in line; the first ticket is running, not waiting', () => {
    mkdirSync(queueDir, { recursive: true })
    const t = (n: number, sessionId?: string, pid = process.pid): void =>
      writeFileSync(path.join(queueDir, `${String(n).padStart(20, '0')}.json`), JSON.stringify({ pid, cmd: 'x', cwd: dir, at: n, ...(sessionId ? { sessionId } : {}) }))
    t(1, 's-run')
    t(2, 'dead', deadPid())
    t(3, 's-a')
    t(4)
    t(5, 's-b')
    writeFileSync(path.join(queueDir, `${'9'.repeat(20)}.json`), '{half')
    expect([...heavyWaits(queueDir)]).toEqual([
      ['s-a', 1],
      ['s-b', 3]
    ])
    expect(heavyWaits(path.join(dir, 'missing')).size).toBe(0)
  })
})
