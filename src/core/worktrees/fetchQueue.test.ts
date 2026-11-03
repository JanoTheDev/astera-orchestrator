// One fetch per repository at a time (git.ts fetchSerially): several plans' origin syncs and deliveries fetched origin
// into the same refs at once, and the loser said "cannot lock ref 'refs/remotes/origin/main': is at X but expected Y"
// (host.log 2026-11-03).
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { fetchSerially, REF_LOCK_RACE, type GitResult } from './git'

const folder = (name: string): string => path.join(os.tmpdir(), `astera-fetch-queue-${process.pid}-${name}`)
const ok: GitResult = { ok: true, stdout: '', stderr: '' }
const noWait = async (): Promise<void> => {}

describe('fetchSerially', () => {
  it('runs one fetch of a repository after the other, never both at once', async () => {
    const cwd = folder('serial')
    const events: string[] = []
    let release!: () => void
    const first = new Promise<void>((r) => (release = r))
    const run = (async (args: string[]) => {
      events.push(`start ${args[1]}`)
      if (args[1] === 'a') await first
      events.push(`end ${args[1]}`)
      return ok
    }) as unknown as typeof import('./git').git
    const a = fetchSerially(['fetch', 'a'], { cwd }, run, noWait)
    const b = fetchSerially(['fetch', 'b'], { cwd }, run, noWait)
    await new Promise((r) => setTimeout(r, 50))
    expect(events).toEqual(['start a'])
    release()
    await Promise.all([a, b])
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b'])
  })

  it('a failed fetch does not stop the next one', async () => {
    const cwd = folder('after-failure')
    const run = (async (args: string[]) => (args[1] === 'a' ? Promise.reject(new Error('boom')) : ok)) as unknown as typeof import('./git').git
    const a = fetchSerially(['fetch', 'a'], { cwd }, run, noWait)
    const b = fetchSerially(['fetch', 'b'], { cwd }, run, noWait)
    await expect(a).rejects.toThrow('boom')
    await expect(b).resolves.toEqual(ok)
  })

  it('tries again after losing a ref-lock race, and answers the try that went through', async () => {
    const cwd = folder('race')
    const race: GitResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: "error: cannot lock ref 'refs/remotes/origin/main': is at b6f7dbd but expected 50fd5f3"
    }
    const answers = [race, race, ok]
    const waits: number[] = []
    const run = (async () => answers.shift()!) as unknown as typeof import('./git').git
    const r = await fetchSerially(['fetch', 'origin', 'main'], { cwd }, run, async (ms) => {
      waits.push(ms)
    })
    expect(r).toEqual(ok)
    expect(waits).toHaveLength(2)
  })

  it('does not try again a fetch that failed for any other reason', async () => {
    const cwd = folder('offline')
    let calls = 0
    const run = (async () => {
      calls++
      return { ok: false, exitCode: 128, stdout: '', stderr: 'fatal: unable to access origin' }
    }) as unknown as typeof import('./git').git
    const r = await fetchSerially(['fetch', 'origin', 'main'], { cwd }, run, noWait)
    expect(r.ok).toBe(false)
    expect(calls).toBe(1)
  })

  it('knows git\'s ref-lock race wordings', () => {
    expect(REF_LOCK_RACE.test("error: cannot lock ref 'refs/remotes/origin/main': is at a but expected b")).toBe(true)
    expect(REF_LOCK_RACE.test("fatal: Unable to create 'C:/r/.git/refs/remotes/origin/main.lock': File exists.")).toBe(true)
    expect(REF_LOCK_RACE.test('fatal: unable to access origin')).toBe(false)
  })
})
