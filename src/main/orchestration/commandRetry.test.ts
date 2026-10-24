import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from '../../core/orchestration/command'
import { emptyState, type OrchState } from '../../core/orchestration/state'
import { OrchStateConflict } from '../../core/orchestration/stateConflict'
import { createMirrorStore } from './mirrorStore'
import { BUSY_ERROR, handleWithRetry } from './commandRetry'

/** Two pending Jobs, made the way the "+ New job" form makes them. */
const twoJobs = async (): Promise<{ state: OrchState; a: string; b: string }> => {
  let state = emptyState()
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }]
  } as unknown as OrchServerDeps
  const make = async (objective: string): Promise<string> => {
    const r = await handleCommand(deps, { sessionId: '' }, 'run-create', { objective, cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true })
    expect(r.status).toBe(200)
    return (r.body as { id: string }).id
  }
  const a = await make('plan A')
  const b = await make('plan B')
  return { state, a, b }
}

/** A Host holding a state and its version. `racing(n)` is asked before put n is accepted: it may commit
 *  something else first, and then the put, built on the older version, is refused with the newer state. */
const rig = async (racing: (put: number, host: { state: OrchState }) => boolean) => {
  const { state, a, b } = await twoJobs()
  const host = { state, version: 1, puts: 0 }
  const mirror = createMirrorStore({
    call: async (m) => {
      if (m.cmd !== 'state-put') throw new Error(`unexpected ${m.cmd}`)
      host.puts++
      if (racing(host.puts, host)) host.version++
      if (m.args.version !== host.version) return { status: 409, body: { state: host.state, version: host.version } }
      host.state = m.args.state as OrchState
      host.version++
      return { status: 200, body: { version: host.version } }
    }
  })
  mirror.accept(state, 1)
  const starts: unknown[] = []
  const deps = {
    getState: () => mirror.getState(),
    setState: (next: OrchState) => mirror.setState(next),
    startCoordinator: async (x: unknown) => {
      starts.push(x)
      return { sessionId: 's1' }
    },
    stopCoordinator: async () => {},
    releaseWorker: async () => {},
    startWorker: async () => ({}),
    readWorker: async () => '',
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }]
  } as unknown as OrchServerDeps
  const sleeps: number[] = []
  const logs: string[] = []
  const plan = () =>
    handleWithRetry(handleCommand, deps, { sessionId: '' }, 'jobs-plan', { id: a }, {
      log: (l) => logs.push(l),
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    })
  return { host, a, b, starts, sleeps, logs, plan, deps }
}

const renamed = (s: OrchState, id: string): OrchState => ({
  ...s,
  jobs: s.jobs.map((j) => (j.id === id ? { ...j, objective: 'changed by the other plan' } : j))
})

describe('handleWithRetry', () => {
  it('a jobs-plan racing a concurrent commit succeeds on retry', async () => {
    const r = await rig((put, host) => {
      if (put !== 1) return false
      host.state = renamed(host.state, r.b)
      return true
    })
    const reply = await r.plan()
    expect(reply.status).toBe(200)
    expect(r.starts).toHaveLength(1)
    expect(r.host.state.jobs.find((j) => j.id === r.a)?.plannerSessionIds).toEqual(['s1'])
    expect(r.host.state.jobs.find((j) => j.id === r.b)?.objective).toBe('changed by the other plan')
    expect(r.sleeps).toEqual([50])
  })

  it('does not re-run a command that conflicts after it acted', async () => {
    const r = await rig((_put, host) => {
      if (r.starts.length === 0 || host.state.jobs.some((j) => j.objective === 'changed by the other plan')) return false
      host.state = renamed(host.state, r.b)
      return true
    })
    const reply = await r.plan()
    expect(reply).toEqual({ status: 409, body: { error: BUSY_ERROR, conflict: 'state-moved-on' } })
    expect(r.starts).toHaveLength(1)
    expect(r.sleeps).toEqual([])
    expect(r.logs[0]).toMatch(/jobs-plan was refused after 1 attempt\(s\), after it had acted outside the state — .*Host at/)
  })

  it('answers in plain words after five conflicts, and logs the versions', async () => {
    const r = await rig((_put, host) => {
      host.state = renamed(host.state, r.b)
      return true
    })
    const reply = await r.plan()
    expect(reply).toEqual({ status: 409, body: { error: BUSY_ERROR, conflict: 'state-moved-on' } })
    expect(BUSY_ERROR).not.toMatch(/\d/)
    expect(r.host.puts).toBe(5)
    expect(r.starts).toHaveLength(0)
    expect(r.sleeps).toEqual([50, 100, 200, 400])
    expect(r.logs[0]).toMatch(/jobs-plan was refused after 5 attempt\(s\) — the orchestration state moved on .*Host at \d+, write built on \d+/)
  })

  it('throws the last conflict instead when asked to', async () => {
    const r = await rig((_put, host) => {
      host.state = renamed(host.state, r.b)
      return true
    })
    await expect(
      handleWithRetry(handleCommand, r.deps, { sessionId: '' }, 'jobs-plan', { id: r.a }, { sleep: async () => {}, throwConflict: true })
    ).rejects.toBeInstanceOf(OrchStateConflict)
  })

  it('answers the re-run’s own refusal when the Job was deleted meanwhile', async () => {
    const r = await rig((put, host) => {
      if (put !== 1) return false
      host.state = { ...host.state, jobs: host.state.jobs.filter((j) => j.id !== r.a) }
      return true
    })
    const reply = await r.plan()
    expect(reply.status).toBe(404)
    expect((reply.body as { error: string }).error).toMatch(/unknown job/)
    expect(r.starts).toHaveLength(0)
  })

  it('rethrows other errors unchanged', async () => {
    const boom = new Error('disk full')
    await expect(
      handleWithRetry(async () => { throw boom }, {} as OrchServerDeps, { sessionId: '' }, 'x', {})
    ).rejects.toBe(boom)
  })
})
