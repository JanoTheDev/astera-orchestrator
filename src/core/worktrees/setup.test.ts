import { describe, it, expect } from 'vitest'
import { promises as fs, readdirSync } from 'node:fs'
import path from 'node:path'
import { tempDir } from './testRepo'
import { detectSetupCommand, runWorktreeSetup, type SetupHeavy } from './setup'
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

// T2: an install waits for one of the machine's heavy slots (the ones `astera heavy` and heavy checks take). The
// commands below run under both cmd.exe and sh: `exit <n>` and `node -e "…"`.
describe('runWorktreeSetup under a heavy slot', () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const WRITE_RAN = `node -e "require('fs').writeFileSync('ran.txt','')"`
  /** A temp lock and queue dir: never the machine's real /tmp/astera-fullsuite.lock, another tab may hold it. */
  const slotAt = async (): Promise<{ lock: string; queueDir: string; pollMs: number }> => {
    const d = await tempDir('astera-setup-heavy-')
    return { lock: path.join(d, 'test.lock'), queueDir: path.join(d, 'queue'), pollMs: 20 }
  }
  /** A slot seam that records what it was asked and hands out a counted release, after `waitMs`. */
  const fakeSlot = (waitMs = 0, answer: 'release' | 'null' | 'throw' = 'release') => {
    const asked: Parameters<typeof heavySlot>[0][] = []
    let released = 0
    const take: SetupHeavy['take'] = async (a) => {
      asked.push(a)
      await sleep(waitMs)
      if (answer === 'throw') throw new Error('could not run flock (util-linux): spawn flock ENOENT')
      return answer === 'null' ? null : () => void released++
    }
    return { take, asked, released: () => released }
  }
  const collect = (): { log: (m: string) => void; logs: string[] } => {
    const logs: string[] = []
    return { log: (m) => void logs.push(m), logs }
  }
  const tickets = (queueDir: string): string[] => readdirSync(queueDir).filter((f) => f.endsWith('.json'))

  it('waits while every slot is taken, and installs once one is freed', async () => {
    const at = await slotAt()
    const holder = (await heavySlot({ ...at, cwd: 'elsewhere', cmd: 'held', slots: 1 }))!
    const dir = await withFiles()
    const { log, logs } = collect()
    let queued = 0
    let done = false
    const setup = runWorktreeSetup({ dir, setting: WRITE_RAN, log, heavy: { slots: async () => 1, queued: () => void queued++, ...at } }).then((r) => {
      done = true
      return r
    })
    await sleep(400)
    expect(done).toBe(false)
    expect(queued).toBe(1)
    await expect(fs.access(path.join(dir, 'ran.txt'))).rejects.toThrow()
    holder()
    expect(await setup).toMatchObject({ ran: true, ok: true })
    await expect(fs.access(path.join(dir, 'ran.txt'))).resolves.toBeUndefined()
    expect(logs.filter((m) => m.includes('waiting for a heavy slot'))).toEqual([expect.stringContaining('waiting for a heavy slot (1 ahead)')])
    expect(logs.some((m) => /took a heavy slot after \d+s/.test(m))).toBe(true)
    // Its ticket is gone and its slot free: the next taker gets it at once
    expect(tickets(at.queueDir)).toEqual([])
    const next = await Promise.race([heavySlot({ ...at, cwd: 'next', cmd: 'next', slots: 1 }), sleep(3000).then(() => 'still held' as const)])
    expect(next).not.toBe('still held')
    if (typeof next === 'function') next()
  })

  it.each([
    ['succeeds', 'exit 0', true],
    ['fails', 'exit 3', false]
  ])('frees its slot when the install %s', async (_, setting, ok) => {
    const slot = fakeSlot()
    const r = await runWorktreeSetup({ dir: await withFiles(), setting, log: () => {}, heavy: { slots: async () => 1, take: slot.take } })
    expect(r).toMatchObject({ ran: true, ok })
    expect(slot.asked).toHaveLength(1)
    expect(slot.released()).toBe(1)
  })

  it('frees its slot when the install times out', async () => {
    const slot = fakeSlot()
    const r = await runWorktreeSetup({
      dir: await withFiles(),
      setting: 'node -e "setTimeout(function(){},30000)"',
      log: () => {},
      timeoutMs: 300,
      heavy: { slots: async () => 1, take: slot.take }
    })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('timed out')
    expect(slot.released()).toBe(1)
  })

  it('starts the install timeout once the slot is held, not while it waits', async () => {
    // A wait longer than the timeout: counted from the queue, the install would time out before it ran
    const slot = fakeSlot(800)
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'exit 0', log: () => {}, timeoutMs: 500, heavy: { slots: async () => 1, take: slot.take } })
    expect(r).toMatchObject({ ran: true, ok: true })
    expect(slot.released()).toBe(1)
  })

  it('asks for a setup ticket in the worktree with the slots read now', async () => {
    const slot = fakeSlot()
    const dir = await withFiles()
    await runWorktreeSetup({ dir, setting: 'exit 0', log: () => {}, heavy: { slots: async () => 3, take: slot.take } })
    expect(slot.asked[0]).toMatchObject({ cwd: dir, cmd: 'exit 0', kind: 'setup', slots: 3 })
  })

  it('passes a Windows lock and queue dir through untouched', async () => {
    const slot = fakeSlot()
    const lock = 'C:\\Users\\me\\AppData\\Local\\Temp\\astera-fullsuite.lock'
    const queueDir = 'D:\\astera\\heavy queue'
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'exit 0', log: () => {}, heavy: { slots: async () => 1, take: slot.take, lock, queueDir } })
    expect(r).toMatchObject({ ran: true, ok: true })
    expect(slot.asked[0]).toMatchObject({ lock, queueDir })
  })

  it.each([
    [
      'node_modules is already there',
      async () => {
        const dir = await withFiles('package-lock.json')
        await fs.mkdir(path.join(dir, 'node_modules'))
        return { dir }
      }
    ],
    ['the setting is off', async () => ({ dir: await withFiles('package-lock.json'), setting: 'off' })],
    ['there is no lockfile', async () => ({ dir: await withFiles() })]
  ])('takes no slot when %s', async (_, given) => {
    const slot = fakeSlot()
    let queued = 0
    const r = await runWorktreeSetup({ ...(await given()), log: () => {}, heavy: { slots: async () => 1, take: slot.take, queued: () => void queued++ } })
    expect(r).toMatchObject({ ran: false })
    expect(slot.asked).toEqual([])
    expect(queued).toBe(0)
  })

  it('gives the install up when nobody wants it any more while it waits, and drops its ticket', async () => {
    const at = await slotAt()
    const holder = (await heavySlot({ ...at, cwd: 'elsewhere', cmd: 'held', slots: 1 }))!
    const dir = await withFiles()
    let wanted = true
    const setup = runWorktreeSetup({ dir, setting: WRITE_RAN, log: () => {}, heavy: { slots: async () => 1, abandoned: () => !wanted, ...at } })
    await sleep(200)
    wanted = false
    expect(await setup).toMatchObject({ ran: false, ok: false, abandoned: true })
    await expect(fs.access(path.join(dir, 'ran.txt'))).rejects.toThrow()
    expect(tickets(at.queueDir)).toHaveLength(1) // the holder's alone
    holder()
  })

  it('runs the install without a slot when the slot cannot be taken', async () => {
    const slot = fakeSlot(0, 'throw')
    const { log, logs } = collect()
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'exit 0', log, heavy: { slots: async () => 1, take: slot.take } })
    expect(r).toMatchObject({ ran: true, ok: true })
    expect(logs.join('\n')).toMatch(/could not take a heavy slot .*runs .* without one/)
  })

  it('leaves the install to a newer one of the same folder that replaced its ticket', async () => {
    const slot = fakeSlot(0, 'null')
    const dir = await withFiles()
    const r = await runWorktreeSetup({ dir, setting: WRITE_RAN, log: () => {}, heavy: { slots: async () => 1, take: slot.take } })
    expect(r).toMatchObject({ ran: false, ok: true })
    await expect(fs.access(path.join(dir, 'ran.txt'))).rejects.toThrow()
  })
})
