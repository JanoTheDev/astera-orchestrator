import { describe, it, expect } from 'vitest'
import { promises as fs, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { tempDir } from './testRepo'
import { detectSetupCommand, installTurn, runWorktreeSetup, untilInstallQueues, type SetupHeavy } from './setup'
import { heavySlot } from '../orchestration/exec/validation'

const withFiles = async (...names: string[]): Promise<string> => {
  const dir = await tempDir('astera-setup-')
  for (const n of names) await fs.writeFile(path.join(dir, n), '')
  return dir
}

describe('detectSetupCommand', () => {
  it.each([
    [['bun.lock'], 'bun install --frozen-lockfile'],
    [['bun.lockb'], 'bun install --frozen-lockfile'],
    [['pnpm-lock.yaml'], 'pnpm install --frozen-lockfile'],
    [['yarn.lock'], 'yarn install --frozen-lockfile'],
    [['package-lock.json'], 'npm ci'],
    [['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock'], 'bun install --frozen-lockfile'],
    [['package-lock.json', 'yarn.lock'], 'yarn install --frozen-lockfile'],
    [[], null]
  ])('%j -> %s', async (files, want) => {
    expect(await detectSetupCommand(await withFiles(...files))).toBe(want)
  })
})

describe('runWorktreeSetup', () => {
  const logs: string[] = []
  const log = (m: string): void => void logs.push(m)

  it('runs the given command in the worktree', async () => {
    const dir = await withFiles()
    const r = await runWorktreeSetup({ dir, setting: 'touch ran.txt', log })
    expect(r).toMatchObject({ ran: true, ok: true, command: 'touch ran.txt' })
    await expect(fs.access(path.join(dir, 'ran.txt'))).resolves.toBeUndefined()
  })

  it('off runs nothing, even with a lockfile', async () => {
    const dir = await withFiles('package-lock.json')
    expect(await runWorktreeSetup({ dir, setting: 'off', log })).toMatchObject({ ran: false })
  })

  it('runs nothing with no setting and no lockfile', async () => {
    expect(await runWorktreeSetup({ dir: await withFiles(), log })).toMatchObject({ ran: false, command: null })
  })

  it('skips when node_modules is already there', async () => {
    const dir = await withFiles()
    await fs.mkdir(path.join(dir, 'node_modules'))
    expect(await runWorktreeSetup({ dir, setting: 'touch ran.txt', log })).toMatchObject({ ran: false })
    await expect(fs.access(path.join(dir, 'ran.txt'))).rejects.toThrow()
  })

  it('force runs even when node_modules is already there', async () => {
    const dir = await withFiles()
    await fs.mkdir(path.join(dir, 'node_modules'))
    expect(await runWorktreeSetup({ dir, setting: 'touch ran.txt', log, force: true })).toMatchObject({ ran: true, ok: true })
    await expect(fs.access(path.join(dir, 'ran.txt'))).resolves.toBeUndefined()
  })

  it('force still honours off', async () => {
    expect(await runWorktreeSetup({ dir: await withFiles('package-lock.json'), setting: 'off', log, force: true })).toMatchObject({ ran: false })
  })

  it('reports a failing command with its output, never throws', async () => {
    logs.length = 0
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'echo boom; exit 3', log })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('exit 3')
    expect(r.tail).toContain('boom')
    expect(logs.join('\n')).toContain('echo boom; exit 3')
  })

  it('reports a missing tool', async () => {
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'astera-no-such-tool-xyz', log })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('127')
  })

  it('reports a timeout and ends the command', async () => {
    const t = Date.now()
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'sleep 30', log, timeoutMs: 200 })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('timed out')
    expect(Date.now() - t).toBeLessThan(5000)
  })
})

describe('runWorktreeSetup with a heavy slot (T2)', () => {
  // Commands through node, so they read the same under cmd.exe and sh
  const node = (js: string): string => `node -e "${js}"`
  const WRITE_RAN = node("require('fs').writeFileSync('ran.txt','')")
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  type Machine = { root: string; at: { lock: string; queueDir: string; pollMs: number }; logs: string[]; log: (m: string) => void }
  /** A queue and lock of the test's own (the Host's are /tmp's), and a log of this test's own. */
  const machine = async (): Promise<Machine> => {
    const root = await tempDir('astera-setup-heavy-')
    const logs: string[] = []
    return { root, at: { lock: path.join(root, 'lock'), queueDir: path.join(root, 'queue'), pollMs: 20 }, logs, log: (m) => void logs.push(m) }
  }
  const tickets = (queueDir: string): string[] => (existsSync(queueDir) ? readdirSync(queueDir).filter((n) => n.endsWith('.json')) : [])
  /** Holds the machine's one slot, as another heavy job would. */
  const holdSlot = async (m: Machine): Promise<() => void> =>
    (await heavySlot({ ...m.at, cwd: path.join(m.root, 'held'), cmd: 'held', kind: 'check' }))!
  /** Whether the slot is free now: a fresh taker gets it within the budget, and gives it straight back. */
  const slotFree = async (m: Machine, ms = 2_000): Promise<boolean> => {
    let late = false
    const took = heavySlot({ ...m.at, cwd: path.join(m.root, 'probe'), cmd: 'probe', kind: 'check', abandoned: () => late })
    const r = await Promise.race([took.then(() => 'took' as const), sleep(ms).then(() => 'busy' as const)])
    late = true
    ;(await took)?.()
    return r === 'took'
  }
  const heavyOf = (m: Machine, over: Partial<SetupHeavy> = {}): SetupHeavy => ({ slots: async () => 1, ...m.at, ...over })

  it('waits while every slot is taken, runs once one is freed, and frees it after success', async () => {
    const m = await machine()
    const holder = await holdSlot(m)
    const dir = await withFiles()
    let queued = 0
    let settled = false
    const done = runWorktreeSetup({ dir, setting: WRITE_RAN, log: m.log, heavy: heavyOf(m, { queued: () => void queued++ }) }).finally(() => {
      settled = true
    })
    await sleep(300)
    expect(settled).toBe(false)
    expect(existsSync(path.join(dir, 'ran.txt'))).toBe(false)
    expect(queued).toBe(1)
    expect(m.logs.filter((l) => l.startsWith('setup: waiting for a heavy slot (1 ahead)'))).toHaveLength(1)
    holder()
    expect(await done).toMatchObject({ ran: true, ok: true, command: WRITE_RAN })
    expect(existsSync(path.join(dir, 'ran.txt'))).toBe(true)
    expect(m.logs.some((l) => /^setup: got a heavy slot after \d+s/.test(l))).toBe(true)
    expect(tickets(m.at.queueDir)).toEqual([])
    expect(await slotFree(m)).toBe(true)
  })

  it('frees the slot after a failing install', async () => {
    const m = await machine()
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: node('process.exit(3)'), log: m.log, heavy: heavyOf(m) })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('exit 3')
    expect(await slotFree(m)).toBe(true)
  })

  it('frees the slot after an install that timed out', async () => {
    const m = await machine()
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: node('setTimeout(()=>{},30000)'), log: m.log, timeoutMs: 300, heavy: heavyOf(m) })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('timed out')
    expect(await slotFree(m)).toBe(true)
  })

  it('starts its timeout once it holds the slot, not while it waits', async () => {
    const m = await machine()
    const holder = await holdSlot(m)
    const done = runWorktreeSetup({ dir: await withFiles(), setting: WRITE_RAN, log: m.log, timeoutMs: 3_000, heavy: heavyOf(m) })
    await new Promise((r) => setTimeout(r, 3_500))
    holder()
    expect(await done).toMatchObject({ ran: true, ok: true })
  }, 20_000)

  it.each([
    ['node_modules is already there', async (dir: string) => void (await fs.mkdir(path.join(dir, 'node_modules'))), WRITE_RAN],
    ['the setting is off', async () => {}, 'off'],
    ['there is no lockfile and no setting', async () => {}, undefined]
  ])('takes no slot when it is skipped: %s', async (_why, prepare, setting) => {
    const m = await machine()
    // Every slot is held: a setup that asked for one would wait here
    const holder = await holdSlot(m)
    const dir = await withFiles()
    await prepare(dir)
    let queued = 0
    const r = await runWorktreeSetup({ dir, log: m.log, ...(setting !== undefined ? { setting } : {}), heavy: heavyOf(m, { queued: () => void queued++ }) })
    expect(r).toMatchObject({ ran: false, ok: true })
    expect(queued).toBe(0)
    expect(tickets(m.at.queueDir)).toHaveLength(1) // the holder's alone
    expect(m.logs).toEqual([])
    holder()
  })

  it('gives up the wait after maxWaitMs: the install is skipped, its ticket dropped, and the worker starts without it', async () => {
    const m = await machine()
    const holder = await holdSlot(m)
    const dir = await withFiles()
    const r = await runWorktreeSetup({ dir, setting: WRITE_RAN, log: m.log, heavy: heavyOf(m, { maxWaitMs: 200 }) })
    expect(r).toMatchObject({ ran: false, ok: false, command: WRITE_RAN })
    expect(r.tail).toContain('no heavy slot came free')
    expect(existsSync(path.join(dir, 'ran.txt'))).toBe(false)
    expect(tickets(m.at.queueDir)).toHaveLength(1)
    holder()
  })

  it('skips an install nobody needs any more, and drops its ticket', async () => {
    const m = await machine()
    const holder = await holdSlot(m)
    let gone = false
    const done = runWorktreeSetup({ dir: await withFiles(), setting: WRITE_RAN, log: m.log, heavy: heavyOf(m, { abandoned: () => gone }) })
    await sleep(100)
    expect(tickets(m.at.queueDir)).toHaveLength(2)
    gone = true
    expect(await done).toMatchObject({ ran: false, ok: true })
    expect(tickets(m.at.queueDir)).toHaveLength(1)
    holder()
  })

  it('runs without a slot when none can be taken, rather than block the worker', async () => {
    const m = await machine()
    // A queue dir under a plain file can never be made
    const file = path.join(m.root, 'not-a-dir')
    await fs.writeFile(file, '')
    const dir = await withFiles()
    const r = await runWorktreeSetup({ dir, setting: WRITE_RAN, log: m.log, heavy: heavyOf(m, { queueDir: path.join(file, 'queue') }) })
    expect(r).toMatchObject({ ran: true, ok: true })
    expect(existsSync(path.join(dir, 'ran.txt'))).toBe(true)
    expect(m.logs.some((l) => l.startsWith('setup: could not take a heavy slot'))).toBe(true)
  })

  it('reads the slot count when it queues: with two slots it runs beside one held slot', async () => {
    const m = await machine()
    const holder = await holdSlot(m)
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: WRITE_RAN, log: m.log, heavy: heavyOf(m, { slots: async () => 2 }) })
    expect(r).toMatchObject({ ran: true, ok: true })
    holder()
  })

  // On Windows the queue dir is a drive-letter path with backslashes (os.tmpdir() there), here with a space as well;
  // nothing in the wait may take it apart as a posix path
  it('waits in a queue dir given as a native path (on Windows: drive letter, backslashes) as in any other', async () => {
    const m = await machine()
    const queueDir = path.join(m.root, 'heavy queue', 'q')
    if (process.platform === 'win32') expect(queueDir).toMatch(/^[A-Za-z]:\\.+\\heavy queue\\q$/)
    const holder = (await heavySlot({ ...m.at, queueDir, cwd: path.join(m.root, 'held'), cmd: 'held' }))!
    const dir = await withFiles()
    const done = runWorktreeSetup({ dir, setting: WRITE_RAN, log: m.log, heavy: heavyOf(m, { queueDir }) })
    await sleep(200)
    expect(tickets(queueDir)).toHaveLength(2)
    holder()
    expect(await done).toMatchObject({ ran: true, ok: true })
    expect(tickets(queueDir)).toEqual([])
  })
})

describe('untilInstallQueues (T2)', () => {
  const heavy = { slots: async () => 1 }
  const deferred = <T>(): { promise: Promise<T>; resolve: (v: T) => void } => {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('answers the start itself when it never installs', async () => {
    expect(await untilInstallQueues(heavy, async () => 'started')).toEqual({ done: 'started' })
  })

  it('answers as soon as the install queues, and the start goes on to settle `rest`', async () => {
    const install = deferred<void>()
    const r = await untilInstallQueues(heavy, async () => {
      await Promise.resolve()
      installTurn()!.queued('D:\\wt\\a')
      await install.promise
      return 'started'
    })
    if (!('queued' in r)) throw new Error('not queued')
    expect(r.queued.dir).toBe('D:\\wt\\a')
    install.resolve()
    expect(await r.queued.rest).toBe('started')
  })

  it('lends the start its turn, and no one outside it', async () => {
    let seen: unknown
    await untilInstallQueues(heavy, async () => {
      await Promise.resolve()
      seen = installTurn()?.heavy
    })
    expect(seen).toBe(heavy)
    expect(installTurn()).toBeUndefined()
  })

  it('rejects with a start that fails before its install queues', async () => {
    await expect(untilInstallQueues(heavy, async () => Promise.reject(new Error('no fork')))).rejects.toThrow('no fork')
  })

  it('leaves a failure after the queue to `rest` alone', async () => {
    const install = deferred<void>()
    const r = await untilInstallQueues(heavy, async () => {
      installTurn()!.queued('/wt/a')
      await install.promise
      throw new Error('spawn failed')
    })
    if (!('queued' in r)) throw new Error('not queued')
    install.resolve()
    await expect(r.queued.rest).rejects.toThrow('spawn failed')
  })
})
