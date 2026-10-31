import { describe, it, expect } from 'vitest'
import { promises as fs, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { makeRepo, tempDir } from './testRepo'
import {
  detectSetupCommand,
  forkAnsweringAtInstall,
  installPending,
  installSettled,
  installTurn,
  runWorktreeSetup,
  untilInstallQueues,
  type InstallTurn,
  type SetupHeavy
} from './setup'
import { heavySlot } from '../orchestration/exec/validation'
import { forkWorktree } from '../orchestration/exec/integrateGit'
import { WorktreeRegistry } from './registry'

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

// Commands through node, so they read the same under cmd.exe (Windows) and sh
const node = (js: string): string => `node -e "${js}"`
const BOOM_EXIT_3 = node("console.log('boom');process.exit(3)")
const TOUCH_RAN = node("require('fs').writeFileSync('ran.txt','')")

describe('runWorktreeSetup', () => {
  const logs: string[] = []
  const log = (m: string): void => void logs.push(m)

  it('runs the given command in the worktree', async () => {
    const dir = await withFiles()
    const r = await runWorktreeSetup({ dir, setting: TOUCH_RAN, log })
    expect(r).toMatchObject({ ran: true, ok: true, command: TOUCH_RAN })
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
    expect(await runWorktreeSetup({ dir, setting: TOUCH_RAN, log })).toMatchObject({ ran: false })
    await expect(fs.access(path.join(dir, 'ran.txt'))).rejects.toThrow()
  })

  it('force runs even when node_modules is already there', async () => {
    const dir = await withFiles()
    await fs.mkdir(path.join(dir, 'node_modules'))
    expect(await runWorktreeSetup({ dir, setting: TOUCH_RAN, log, force: true })).toMatchObject({ ran: true, ok: true })
    await expect(fs.access(path.join(dir, 'ran.txt'))).resolves.toBeUndefined()
  })

  it('force still honours off', async () => {
    expect(await runWorktreeSetup({ dir: await withFiles('package-lock.json'), setting: 'off', log, force: true })).toMatchObject({ ran: false })
  })

  it('reports a failing command with its output, never throws', async () => {
    logs.length = 0
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: BOOM_EXIT_3, log })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('exit 3')
    expect(r.tail).toContain('boom')
    expect(logs.join('\n')).toContain(JSON.stringify(BOOM_EXIT_3)) // the log quotes the command as JSON
  })

  it('reports a missing tool', async () => {
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'astera-no-such-tool-xyz', log })
    expect(r).toMatchObject({ ran: true, ok: false })
    // sh says 127 for a missing command; cmd.exe says 1
    expect(r.tail).toContain(process.platform === 'win32' ? 'exit 1' : '127')
  })

  it('reports a timeout and ends the command', async () => {
    const t = Date.now()
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: node('setTimeout(()=>{},30000)'), log, timeoutMs: 200 })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('timed out')
    expect(Date.now() - t).toBeLessThan(5000)
  })
})

describe('runWorktreeSetup with a heavy slot (T2)', () => {
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

// T24: the Run worktree's forks (the scheduler's lazy one, run-start's makeRunWorktree) answer once the install queues,
// and the app's own forks wait for a slot in place. Each takes one of the machine's heavy slots and gives it back.
describe('forks that take a heavy slot for their install (T24)', () => {
  const node = (js: string): string => `node -e "${js}"`
  const WRITE_RAN = node("require('fs').writeFileSync('ran.txt','')")
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  type At = { lock: string; queueDir: string; pollMs: number }
  /** A queue and lock of the test's own. On Windows a drive-letter path with backslashes, here with a space too. */
  const machine = async (): Promise<{ root: string; at: At; logs: string[]; log: (m: string) => void }> => {
    const root = await tempDir('astera-setup-fork-')
    const logs: string[] = []
    const at = { lock: path.join(root, 'heavy lock'), queueDir: path.join(root, 'heavy queue'), pollMs: 20 }
    if (process.platform === 'win32') expect(at.queueDir).toMatch(/^[A-Za-z]:\\.+\\heavy queue$/)
    return { root, at, logs, log: (m) => void logs.push(m) }
  }
  const tickets = (queueDir: string): string[] => (existsSync(queueDir) ? readdirSync(queueDir).filter((n) => n.endsWith('.json')) : [])
  const holdSlot = async (at: At, root: string): Promise<() => void> =>
    (await heavySlot({ ...at, cwd: path.join(root, 'held'), cmd: 'held', kind: 'check' }))!
  const slotFree = async (at: At, root: string, ms = 2_000): Promise<boolean> => {
    let late = false
    const took = heavySlot({ ...at, cwd: path.join(root, 'probe'), cmd: 'probe', kind: 'check', abandoned: () => late })
    const r = await Promise.race([took.then(() => 'took' as const), sleep(ms).then(() => 'busy' as const)])
    late = true
    ;(await took)?.()
    return r === 'took'
  }
  /** What forkWorktree does after its git half, with bounds a test can wait out: the install under the lent turn. */
  const fakeFork =
    (o: { setting: string; maxWaitMs?: number; timeoutMs?: number; log: (m: string) => void }) =>
    async (): Promise<string> => {
      const dir = await withFiles()
      const turn = installTurn()!
      await runWorktreeSetup({
        dir,
        setting: o.setting,
        log: o.log,
        ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
        heavy: { ...turn.heavy, ...(o.maxWaitMs !== undefined ? { maxWaitMs: o.maxWaitMs } : {}), queued: () => turn.queued(dir) }
      })
      return dir
    }

  it('installPending holds from the queue to the end of the start, case-folded on Windows, and installSettled says when', async () => {
    let finish!: () => void
    const install = new Promise<void>((r) => (finish = r))
    const dir = process.platform === 'win32' ? 'D:\\Work Trees\\Plan A' : '/work trees/plan a'
    const r = await untilInstallQueues({ slots: async () => 1 }, async () => {
      installTurn()!.queued(dir)
      await install
      return 'started'
    })
    if (!('queued' in r)) throw new Error('not queued')
    const q = path.join(await tempDir('astera-empty-q-'), 'q')
    expect(installPending(dir, q)).toBe(true)
    if (process.platform === 'win32') expect(installPending('d:\\work trees\\PLAN A\\', q)).toBe(true)
    const settled = installSettled(dir)
    expect(settled).toBeDefined()
    finish()
    await settled
    expect(installPending(dir, q)).toBe(false)
    expect(installSettled(dir)).toBeUndefined()
  })

  it("installPending also reads another process's waiting install from the heavy queue, and only a setup ticket", async () => {
    const m = await machine()
    const holder = await holdSlot(m.at, m.root)
    const dir = await withFiles()
    let gone = false
    const setup = heavySlot({ ...m.at, cwd: dir, cmd: 'npm ci', kind: 'setup', abandoned: () => gone })
    await sleep(100)
    expect(installPending(dir, m.at.queueDir)).toBe(true)
    // A check of a folder is no install
    const other = await withFiles()
    const check = heavySlot({ ...m.at, cwd: other, cmd: 'npm test', kind: 'check', abandoned: () => gone })
    await sleep(100)
    expect(installPending(other, m.at.queueDir)).toBe(false)
    gone = true
    ;(await setup)?.()
    ;(await check)?.()
    expect(installPending(dir, m.at.queueDir)).toBe(false)
    holder()
  })

  it('answers the folder once its install queues, then installs under the slot and gives it back (success)', async () => {
    const m = await machine()
    const holder = await holdSlot(m.at, m.root)
    const dir = await forkAnsweringAtInstall({ slots: async () => 1, ...m.at }, fakeFork({ setting: WRITE_RAN, log: m.log }), m.log)
    // Answered while the slot is still held: nothing ran yet, the folder is installing
    expect(existsSync(path.join(dir, 'ran.txt'))).toBe(false)
    expect(installPending(dir, m.at.queueDir)).toBe(true)
    expect(m.logs.some((l) => l.includes(`the fork answers ${dir} now`))).toBe(true)
    holder()
    await installSettled(dir)
    expect(existsSync(path.join(dir, 'ran.txt'))).toBe(true)
    expect(installPending(dir, m.at.queueDir)).toBe(false)
    expect(tickets(m.at.queueDir)).toEqual([])
    expect(await slotFree(m.at, m.root)).toBe(true)
  })

  it('gives the slot back after a failing install', async () => {
    const m = await machine()
    const dir = await forkAnsweringAtInstall({ slots: async () => 1, ...m.at }, fakeFork({ setting: node('process.exit(3)'), log: m.log }), m.log)
    await installSettled(dir)
    expect(m.logs.some((l) => l.includes('failed in') && l.includes('exit 3'))).toBe(true)
    expect(installPending(dir, m.at.queueDir)).toBe(false)
    expect(await slotFree(m.at, m.root)).toBe(true)
  })

  it('gives the slot back after an install that timed out', async () => {
    const m = await machine()
    const dir = await forkAnsweringAtInstall(
      { slots: async () => 1, ...m.at },
      fakeFork({ setting: node('setTimeout(()=>{},60000)'), timeoutMs: 300, log: m.log }),
      m.log
    )
    await installSettled(dir)
    expect(m.logs.some((l) => l.includes('timed out after'))).toBe(true)
    expect(await slotFree(m.at, m.root)).toBe(true)
  })

  it('stops waiting for the slot after its bound and drops its ticket; the folder is no longer installing', async () => {
    const m = await machine()
    const holder = await holdSlot(m.at, m.root)
    const dir = await forkAnsweringAtInstall({ slots: async () => 1, ...m.at }, fakeFork({ setting: WRITE_RAN, maxWaitMs: 200, log: m.log }), m.log)
    await installSettled(dir)
    expect(existsSync(path.join(dir, 'ran.txt'))).toBe(false)
    expect(m.logs.some((l) => l.includes('no heavy slot came free'))).toBe(true)
    expect(installPending(dir, m.at.queueDir)).toBe(false)
    expect(tickets(m.at.queueDir)).toHaveLength(1) // the holder's own
    holder()
  })

  it('stops waiting once the folder is removed (run-start discarded it), or once the caller gives it up', async () => {
    const m = await machine()
    const holder = await holdSlot(m.at, m.root)
    const dir = await forkAnsweringAtInstall({ slots: async () => 1, ...m.at }, fakeFork({ setting: WRITE_RAN, log: m.log }), m.log)
    await fs.rm(dir, { recursive: true, force: true })
    await installSettled(dir)
    expect(m.logs.some((l) => l.includes('nobody needs it any more'))).toBe(true)
    let given = false
    const dir2 = await forkAnsweringAtInstall({ slots: async () => 1, ...m.at, abandoned: () => given }, fakeFork({ setting: WRITE_RAN, log: m.log }), m.log)
    given = true
    await installSettled(dir2)
    expect(existsSync(path.join(dir2, 'ran.txt'))).toBe(false)
    expect(tickets(m.at.queueDir)).toHaveLength(1)
    holder()
  })

  it('answers a fork that installs nothing as it ends, and marks nothing as installing', async () => {
    const m = await machine()
    const dir = await forkAnsweringAtInstall({ slots: async () => 1, ...m.at }, fakeFork({ setting: 'off', log: m.log }), m.log)
    expect(installPending(dir, m.at.queueDir)).toBe(false)
    expect(installSettled(dir)).toBeUndefined()
  })

  it('rejects with a fork whose git half fails', async () => {
    const m = await machine()
    await expect(
      forkAnsweringAtInstall({ slots: async () => 1, ...m.at }, () => Promise.reject(new Error('NO_REPO: gone')), m.log)
    ).rejects.toThrow('NO_REPO')
  })

  // The app's own forks (OrchCoordinator.createWorktree with no install turn) wait for the slot in place
  it('forkWorktree with ctx.heavy and no turn waits for a slot, installs under it and gives it back', async () => {
    const m = await machine()
    const repo = await makeRepo('astera-setup-forkheavy-')
    const regRoot = await tempDir('astera-setup-forkheavy-reg-')
    const registry = new WorktreeRegistry(path.join(regRoot, 'worktrees.json'), regRoot)
    await registry.load()
    const holder = await holdSlot(m.at, m.root)
    const heavy: InstallTurn['heavy'] = { slots: async () => 1, ...m.at }
    let settled = false
    const fork = forkWorktree({ repoPath: repo, name: 'app-fork' }, { registry, log: m.log, setupCommand: WRITE_RAN, heavy }).finally(() => {
      settled = true
    })
    for (let i = 0; i < 100 && !m.logs.some((l) => l.startsWith('setup: waiting for a heavy slot')); i++) await sleep(50)
    await sleep(200)
    expect(settled).toBe(false)
    expect(m.logs.some((l) => l.startsWith('setup: waiting for a heavy slot'))).toBe(true)
    holder()
    const dir = await fork
    expect(existsSync(path.join(dir, 'ran.txt'))).toBe(true)
    expect(await slotFree(m.at, m.root)).toBe(true)
  }, 30_000)
})
