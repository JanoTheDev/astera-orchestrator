// T3: `jobs-plan` under OrchStateConflict. In main the command runs on a mirror of the Host's state; a refused write moves
// the mirror onto the Host's state and throws. Everything before the planner starts is one write (a re-run starts clean),
// and nothing after it starts throws a conflict out (the started planner is never lost or doubled).
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { OrchStateConflict } from './stateConflict'

const NOW = '2026-10-17T00:00:00.000Z'
const PLANNER = 'ses-planner'

interface Rig {
  deps: OrchServerDeps
  state: () => OrchState
  /** setState calls so far */
  writes: () => number
  /** The setState calls (1-based, counted from now) that are refused after the Host's newer state is swapped in */
  refuse: (...calls: number[]) => void
  /** setState calls made before each planner start */
  writesAtStart: number[]
  stopped: Array<[string, string | undefined]>
  failStart: (e: Error | null) => void
}

// The planner.test.ts rig, with a setState that can be refused the way the mirror refuses it
const rig = (): Rig => {
  let state: OrchState = emptyState()
  let writes = 0
  let refused = new Set<number>()
  let startError: Error | null = null
  const writesAtStart: number[] = []
  const stopped: Array<[string, string | undefined]> = []
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      writes++
      if (refused.has(writes)) {
        // The Host committed something in between: the mirror is already on its state when the write is refused
        state = { ...state, jobs: state.jobs.map((j) => ({ ...j, objective: `${j.objective} (host)` })) }
        throw new OrchStateConflict(writes + 1, writes)
      }
      state = next
    },
    startCoordinator: async (a: Record<string, unknown>) => {
      writesAtStart.push(writes)
      if (startError) throw startError
      return { sessionId: a.role === 'planner' ? PLANNER : 'ses-coordinator' }
    },
    stopCoordinator: async (sessionId: string, reason?: string) => {
      stopped.push([sessionId, reason])
    },
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    now: () => NOW
  } as unknown as OrchServerDeps
  return {
    deps,
    state: () => state,
    writes: () => writes,
    refuse: (...calls) => {
      refused = new Set(calls.map((n) => writes + n))
    },
    writesAtStart,
    stopped,
    failStart: (e) => {
      startError = e
    }
  }
}

const person = (r: Rig) => (cmd: string, args: Record<string, unknown>) => handleCommand(r.deps, { sessionId: '' }, cmd, args)

const newJob = async (r: Rig): Promise<string> => {
  const made = await person(r)('run-create', { objective: 'add a login page', cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true })
  return (made.body as { id: string }).id
}
const jobOf = (r: Rig, id: string) => r.state().jobs.find((j) => j.id === id)!

const FLAGS = { replan: 'waves', planning: 'auto', handsOff: 'on', autoApprove: 'on', delivery: 'push', concurrency: '3' }

describe('jobs-plan under a state conflict', () => {
  it('writes every pre-start field and the planned mark in one setState', async () => {
    const r = rig()
    const id = await newJob(r)
    const before = r.writes()
    expect((await person(r)('jobs-plan', { id, ...FLAGS })).status).toBe(200)
    expect(r.writesAtStart).toEqual([before + 1])
    const j = jobOf(r, id)
    expect(j).toMatchObject({
      replan: 'waves',
      planning: 'auto',
      handsOff: true,
      autoApprove: true,
      delivery: 'push',
      concurrency: 3,
      review: true,
      convergence: {},
      plannerAccountId: 'acc1',
      plannerSessionIds: [PLANNER]
    })
  })

  it('a refused pre-start write lands nothing and starts no planner', async () => {
    const r = rig()
    const id = await newJob(r)
    const was = jobOf(r, id)
    r.refuse(1)
    await expect(person(r)('jobs-plan', { id, ...FLAGS })).rejects.toThrow(OrchStateConflict)
    expect(r.writesAtStart).toEqual([])
    expect(jobOf(r, id)).toEqual({ ...was, objective: `${was.objective} (host)` })
  })

  it('re-applies the post-start record after a conflict and answers with the session', async () => {
    const r = rig()
    const id = await newJob(r)
    r.refuse(2)
    const planned = await person(r)('jobs-plan', { id })
    expect(planned.status).toBe(200)
    expect(planned.body).toMatchObject({ jobId: id, sessionId: PLANNER })
    // Re-applied on the Host's state: its own change stays
    expect(jobOf(r, id)).toMatchObject({ plannerSessionIds: [PLANNER], objective: 'add a login page (host)' })
    expect(r.stopped).toEqual([])
  })

  it('a persistent post-start conflict stops the planner, unmarks the Job and refuses', async () => {
    const r = rig()
    const id = await newJob(r)
    r.refuse(2, 3, 4, 5, 6)
    const planned = await person(r)('jobs-plan', { id })
    expect(planned.status).toBe(409)
    expect((planned.body as { error: string }).error).toMatch(/busy saving other work/)
    expect(r.stopped.map(([sid]) => sid)).toEqual([PLANNER])
    expect(jobOf(r, id).plannerSessionIds).toBeUndefined()
  })

  it('a failed start unmarks the Job, also on a re-run after a refused write', async () => {
    const r = rig()
    const id = await newJob(r)
    r.refuse(1)
    await expect(person(r)('jobs-plan', { id, replan: 'waves' })).rejects.toThrow(OrchStateConflict)
    r.failStart(new Error('no room'))
    // The unmark itself is refused once and re-applied
    r.refuse(2)
    const planned = await person(r)('jobs-plan', { id, replan: 'waves' })
    expect(planned.status).toBe(400)
    expect(jobOf(r, id).plannerSessionIds).toBeUndefined()
    expect(jobOf(r, id).replan).toBe('waves')
  })
})
