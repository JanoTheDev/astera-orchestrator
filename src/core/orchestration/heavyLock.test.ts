// W8-C heavy: the machine-wide heavy-job slot. Real `flock` and real child processes, on a temp lock and queue dir
// (never /tmp/astera-fullsuite.lock: another tab's real full suite may hold it).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HEAVY_LOCK, heavyQueue, heavySlotLock, heavyWaits, runHeavy } from './heavyLock'

let dir: string
let lock: string
let queueDir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astera-heavy-'))
  lock = path.join(dir, 'test.lock')
  queueDir = path.join(dir, 'queue')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const run = (argv: string[], sessionId?: string, slots?: number): Promise<number> =>
  runHeavy({ argv, env: process.env, cwd: dir, lock, queueDir, pollMs: 50, stdio: 'ignore', sessionId, slots, err: () => {} })

/** A `node -e` that logs its start and end to `out`, holding the slot for `ms`. */
const step = (out: string, name: string, ms = 150): string[] => [
  '--',
  process.execPath,
  '-e',
  `const fs=require('fs');fs.appendFileSync(${JSON.stringify(out)},'start ${name}\\n');setTimeout(()=>fs.appendFileSync(${JSON.stringify(out)},'end ${name}\\n'),${ms})`
]

// The tests that drive the real flock binary or POSIX signals: Windows has neither, and its heavy slots are covered by
// heavyLock.win.test.ts. Off Windows they still run; without flock on PATH they are skipped.
const posixFlock = process.platform !== 'win32' && spawnSync('flock', ['--version']).status === 0

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

  it.skipIf(!posixFlock)('releases the slot when the holder is killed, and the next caller runs', async () => {
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

  it.skipIf(!posixFlock)('shares the slot with a hand-opened tab that holds the same lock with flock', async () => {
    const out = path.join(dir, 'log')
    const hand = spawn('flock', [lock, process.execPath, '-e', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(out)},'start hand\\n');setTimeout(()=>fs.appendFileSync(${JSON.stringify(out)},'end hand\\n'),300)`])
    const handDone = new Promise((r) => hand.on('exit', r))
    await until(() => existsSync(out))
    expect(await run(step(out, 'heavy', 10))).toBe(0)
    await handDone
    expect(readFileSync(out, 'utf8').trim().split('\n')).toEqual(['start hand', 'end hand', 'start heavy', 'end heavy'])
  })

  it('with two slots runs two callers at once, and a third waits for one of them, in arrival order', async () => {
    const out = path.join(dir, 'log')
    const a = run(step(out, 'A', 400), undefined, 2)
    await until(() => existsSync(out))
    const b = run(step(out, 'B', 400), undefined, 2)
    await until(() => readFileSync(out, 'utf8').includes('start B'))
    const c = run(step(out, 'C', 10), undefined, 2)
    expect(await Promise.all([a, b, c])).toEqual([0, 0, 0])
    const lines = readFileSync(out, 'utf8').trim().split('\n')
    expect(lines.slice(0, 2)).toEqual(['start A', 'start B'])
    expect(lines.indexOf('start C')).toBeGreaterThan(lines.indexOf('end A'))
    expect(heavyQueue(queueDir)).toEqual([])
  })

  it.skipIf(!posixFlock)('takes slot 1 when a hand-opened tab holds slot 0', async () => {
    const out = path.join(dir, 'log')
    const hand = spawn('flock', [lock, process.execPath, '-e', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(out)},'start hand\\n');setTimeout(()=>fs.appendFileSync(${JSON.stringify(out)},'end hand\\n'),600)`])
    const handDone = new Promise((r) => hand.on('exit', r))
    await until(() => existsSync(out))
    const slot1 = heavySlotLock(lock, 1)
    // The command checks that it runs under slot 1: a second flock -n on it fails
    expect(await run(['--', 'sh', '-c', `flock -n ${slot1} true && exit 3; echo heavy >> ${out}`], undefined, 2)).toBe(0)
    await handDone
    expect(readFileSync(out, 'utf8').trim().split('\n')).toEqual(['start hand', 'heavy', 'end hand'])
  })

  it('names slot 0 as the shared lock itself and slot k beside it', () => {
    expect(heavySlotLock(HEAVY_LOCK, 0)).toBe('/tmp/astera-fullsuite.lock')
    expect(heavySlotLock(HEAVY_LOCK, 1)).toBe('/tmp/astera-fullsuite.1.lock')
    expect(heavySlotLock(HEAVY_LOCK, 7)).toBe('/tmp/astera-fullsuite.7.lock')
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
    // Two slots: the first two live tickets (s-run, s-a) run; the session-less one is 1st in line, s-b 2nd
    expect([...heavyWaits(queueDir, undefined, 2)]).toEqual([['s-b', 2]])
  })
})

describe('orchestration-guide W8-C block', () => {
  it('tells workers to use astera heavy, that hand tabs share the lock, and never to kill the orchestrator', () => {
    const guide = readFileSync(path.resolve(__dirname, '../../../resources/skills/orchestration-guide.md'), 'utf8')
    expect(guide).toContain('astera heavy -- nice -n 10 npx vitest run --maxWorkers=2')
    expect(guide).toContain('flock /tmp/astera-fullsuite.lock <command>')
    expect(guide).toContain('Never stop, restart or `pkill` the orchestrating Astera app or its Host')
  })
})
