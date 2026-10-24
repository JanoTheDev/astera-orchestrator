import { describe, it, expect, vi } from 'vitest'
import { OrchStateConflict, isStateConflict, rerunOnConflict, commitFresh } from './stateConflict'
import { emptyState, type OrchState } from './state'

const conflict = () => new OrchStateConflict(2, 1)
const noSleep = async () => {}

describe('isStateConflict', () => {
  it('counts an instance and an error from another module copy by name', () => {
    const copy = Object.assign(new Error('moved on'), { name: 'OrchStateConflict' })
    expect(isStateConflict(conflict())).toBe(true)
    expect(isStateConflict(copy)).toBe(true)
    expect(isStateConflict(new Error('disk'))).toBe(false)
    expect(isStateConflict('OrchStateConflict')).toBe(false)
  })
})

describe('rerunOnConflict', () => {
  it('re-runs after one conflict and returns the second result', async () => {
    const run = vi.fn(async (attempt: number) => {
      if (attempt === 1) throw conflict()
      return 'ok'
    })
    await expect(rerunOnConflict(run, { sleep: noSleep })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('stops after 5 attempts and rethrows the conflict', async () => {
    const run = vi.fn(async () => {
      throw conflict()
    })
    await expect(rerunOnConflict(run, { sleep: noSleep })).rejects.toBeInstanceOf(OrchStateConflict)
    expect(run).toHaveBeenCalledTimes(5)
  })

  it('does not re-run a non-conflict error', async () => {
    const boom = new Error('disk full')
    const run = vi.fn(async () => {
      throw boom
    })
    await expect(rerunOnConflict(run, { sleep: noSleep })).rejects.toBe(boom)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not re-run when mayRerun returns false', async () => {
    const run = vi.fn(async () => {
      throw conflict()
    })
    await expect(rerunOnConflict(run, { sleep: noSleep, mayRerun: () => false })).rejects.toBeInstanceOf(OrchStateConflict)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('sleeps 50, 100, 200, 400 ms between the five attempts', async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve())
    const run = vi.fn(async () => {
      throw conflict()
    })
    await expect(rerunOnConflict(run, { sleep })).rejects.toBeInstanceOf(OrchStateConflict)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([50, 100, 200, 400])
  })
})

describe('commitFresh', () => {
  const base = (over: Partial<OrchState> = {}): OrchState => ({ ...emptyState(), ...over })

  it('re-applies f to the newer state after a conflict and keeps its other fields', async () => {
    // The Host already moved on: the first write is refused, and the mirror now holds `fresh`.
    const fresh = base({ jobs: [{ id: 'job_1' }] as never, gates: [{ id: 'gat_9' }] as never })
    let host = fresh
    const getState = vi.fn(() => host)
    const setState = vi.fn(async (s: OrchState) => {
      if (setState.mock.calls.length === 1) throw conflict()
      host = s
    })
    const f = vi.fn((cur: OrchState) => ({ ...cur, jobs: [...cur.jobs, { id: 'job_2' }] as never }))

    await expect(commitFresh({ getState, setState }, f, { sleep: noSleep })).resolves.toBe(true)

    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[1][0]).toBe(fresh)
    expect(host.gates).toEqual(fresh.gates)
    expect(host.jobs).toEqual([{ id: 'job_1' }, { id: 'job_2' }])
  })

  it('returns false and writes nothing when f returns null', async () => {
    const setState = vi.fn(async () => {})
    await expect(commitFresh({ getState: () => base(), setState }, () => null)).resolves.toBe(false)
    expect(setState).not.toHaveBeenCalled()
  })

  it('passes the write option through to setState', async () => {
    const setState = vi.fn(async () => {})
    await commitFresh({ getState: () => base(), setState }, (cur) => cur, { how: { rollsBack: true } })
    expect(setState).toHaveBeenCalledWith(expect.anything(), { rollsBack: true })
  })
})
