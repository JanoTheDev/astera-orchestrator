import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../core/types'
import { emptyState, type OrchState } from '../core/orchestration/state'
import type { Dispatch, JobRun, Task } from '../core/orchestration/types'
import type { AgentRun } from '../core/understanding/agent'
import { rollupMarkdown } from '../core/sessions/summary'
import { createHostSummaries, endedTabsOf, type HostSummariesDeps } from './hostSummaries'

const task = (over: Partial<Task>): Task =>
  ({ id: 't1', runId: 'r1', title: 'Add login', spec: '', deps: [], status: 'dispatched', consecutiveFailures: 0, createdAt: '', updatedAt: '', ...over }) as Task
const dispatch = (id: string, over: Partial<Dispatch> = {}): Dispatch =>
  ({ id, taskId: 't1', sessionId: `s-${id}`, accountId: 'a1', cwd: '/wt/t1', startedAt: `2026-10-18T10:0${id.length}:00.000Z`, git: { base: 'aaa', head: 'bbb' }, ...over }) as Dispatch
const state = (over: Partial<OrchState>): OrchState => ({ ...emptyState(), ...over })
const run = { id: 'r1', jobId: 'j1', coordinatorSessionId: 's-coord' } as JobRun

const account = { id: 'a1', provider: 'claude', configDir: '/cfg' } as unknown as Account

describe('endedTabsOf', () => {
  const working = state({ tasks: [task({})], dispatches: [dispatch('d')] })

  it('a Task that merges ends its worker sessions, not its reviewers', () => {
    const next = state({
      tasks: [task({ status: 'completed' })],
      dispatches: [dispatch('d', { endedAt: 'x' }), dispatch('dd', { review: true, sessionId: 's-rev' })]
    })
    expect(endedTabsOf(working, next)).toEqual([{ sessionId: 's-d', taskId: 't1' }])
  })

  it('a worker that exits while its Task is still being validated waits for the Task', () => {
    const next = state({ tasks: [task({ status: 'validating' })], dispatches: [dispatch('d', { endedAt: 'x' })] })
    expect(endedTabsOf(working, next)).toEqual([])
  })

  it('a worker replaced by a retry is ended at once', () => {
    const next = state({
      tasks: [task({ status: 'dispatched' })],
      dispatches: [dispatch('d', { endedAt: 'x' }), dispatch('d2x', { startedAt: '2026-10-18T11:00:00.000Z' })]
    })
    expect(endedTabsOf(working, next)).toEqual([{ sessionId: 's-d', taskId: 't1' }])
  })

  it('a Task already over before the commit is not ended again', () => {
    const over = state({ tasks: [task({ status: 'completed' })], dispatches: [dispatch('d', { endedAt: 'x' })] })
    expect(endedTabsOf(over, over)).toEqual([])
  })
})

describe('createHostSummaries', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'summaries-'))
  })
  afterEach(async () => {
    vi.useRealTimers()
    await rm(dir, { recursive: true, force: true })
  })

  const make = (over: Partial<HostSummariesDeps> = {}, st: OrchState | null = null) => {
    const agent = vi.fn(async (): Promise<AgentRun> => ({ ok: true, value: { text: 'Added the login form.' } }))
    const diffOf = vi.fn(async () => [{ path: 'src/login.ts', added: 5, removed: 1 }])
    const s = createHostSummaries({
      file: path.join(dir, 'summaries.json'),
      enabled: async () => true,
      state: () => st,
      activity: () => [],
      sessionInfo: async (id) => ({ title: `tab ${id}`, cwd: '/work', accountId: 'a1' }),
      diffOf,
      commitsOf: async () => ['feat: login'],
      unitOf: async () => ({ checks: [{ name: 'vitest', status: 'passed' }], resultSummary: 'did it' }),
      tailOf: async () => 'bye',
      accounts: async () => [account],
      descriptors: {} as HostSummariesDeps['descriptors'],
      generatorAccountId: async () => undefined,
      roleModels: async () => ({}),
      idleMs: 1000,
      now: () => '2026-10-18T10:30:00.000Z',
      log: () => {},
      runAgent: agent as unknown as HostSummariesDeps['runAgent'],
      ...over
    })
    return { s, agent, diffOf }
  }

  const merged = state({
    jobs: [{ id: 'j1' } as never],
    runs: [run],
    tasks: [task({ status: 'completed', result: 'login done' })],
    dispatches: [dispatch('d', { endedAt: '2026-10-18T10:25:00.000Z' }), dispatch('rv', { review: true, sessionId: 's-rev' })]
  })
  const before = state({ ...merged, tasks: [task({})] })

  it('a merged worker gets a card with facts and prose, and the roll-up reads it', async () => {
    const { s, agent } = make({}, merged)
    s.committed(before, merged)
    await s.settled()
    const cards = await s.read('j1')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      sessionId: 's-d',
      jobId: 'j1',
      taskId: 't1',
      outcome: 'merged',
      text: 'Added the login form.',
      facts: { review: { rounds: 1 }, files: [{ path: 'src/login.ts' }], commits: ['feat: login'] }
    })
    expect(await s.read('other')).toEqual([])
    expect(agent).toHaveBeenCalledTimes(1)
    expect(JSON.stringify((agent.mock.calls[0] as unknown[])[0])).toContain('did it')
    expect(rollupMarkdown(cards)).toContain('## What each task did')
  })

  it('is idempotent: the same commit twice, and a later trigger for the same session, make one card and one call', async () => {
    const { s, agent } = make({}, merged)
    s.committed(before, merged)
    s.committed(before, merged)
    await s.settled()
    s.committed(before, merged)
    await s.settled()
    expect(await s.read()).toHaveLength(1)
    expect(agent).toHaveBeenCalledTimes(1)
    // a new Host process: the file alone ends it
    const again = make({}, merged)
    again.s.committed(before, merged)
    await again.s.settled()
    expect(again.agent).not.toHaveBeenCalled()
    expect(await again.s.read()).toHaveLength(1)
  })

  it('a failed, timed-out or refused model call stores the facts with no prose, once', async () => {
    for (const answer of [
      async (): Promise<AgentRun> => ({ ok: false, reason: '90초 안에 끝나지 않았다' }),
      async (): Promise<AgentRun> => {
        throw new Error('boom')
      },
      async (): Promise<AgentRun> => ({ ok: true, value: { nope: 1 } })
    ]) {
      await rm(path.join(dir, 'summaries.json'), { force: true })
      const agent = vi.fn(answer)
      const { s } = make({ runAgent: agent as unknown as HostSummariesDeps['runAgent'] }, merged)
      s.committed(before, merged)
      await s.settled()
      s.committed(before, merged)
      await s.settled()
      const [card] = await s.read()
      expect(card.text).toBe('')
      expect(card.model).toBeUndefined()
      expect(card.facts.files).toHaveLength(1)
      expect(agent).toHaveBeenCalledTimes(1)
    }
  })

  it('no account to ask means facts only, with no call', async () => {
    const { s, agent } = make({ accounts: async () => [] }, merged)
    s.committed(before, merged)
    await s.settled()
    expect((await s.read())[0].text).toBe('')
    expect(agent).not.toHaveBeenCalled()
  })

  it('the setting off writes nothing', async () => {
    const { s, agent } = make({ enabled: async () => false }, merged)
    s.committed(before, merged)
    await s.settled()
    expect(await s.read()).toEqual([])
    expect(agent).not.toHaveBeenCalled()
  })

  it('a plain session that idled at a finished turn with writes gets a card; a new turn restarts the clock', async () => {
    vi.useFakeTimers()
    const { s } = make({}, state({}))
    s.sessionBusy('s-plain', false)
    vi.advanceTimersByTime(900)
    s.sessionBusy('s-plain', true)
    s.sessionBusy('s-plain', false)
    vi.advanceTimersByTime(900)
    expect(await s.read()).toEqual([])
    vi.advanceTimersByTime(200)
    vi.useRealTimers()
    await s.settled()
    const [card] = await s.read()
    expect(card).toMatchObject({ sessionId: 's-plain', outcome: 'done', facts: { role: 'session', title: 'tab s-plain' } })
    expect(card.taskId).toBeUndefined()
  })

  it('a plain session that wrote nothing gets no card, and may get one after it writes', async () => {
    const diffOf = vi.fn(async () => [] as { path: string }[])
    const { s } = make({ diffOf }, state({}))
    s.sessionExited('s-plain')
    await s.settled()
    expect(await s.read()).toEqual([])
    diffOf.mockResolvedValue([{ path: 'a.ts' }])
    s.sessionExited('s-plain')
    await s.settled()
    expect(await s.read()).toHaveLength(1)
  })

  it('a plan session (worker, coordinator) is never a plain session', async () => {
    const { s, agent } = make({}, merged)
    s.sessionExited('s-coord')
    s.sessionExited('s-rev')
    await s.settled()
    expect(await s.read()).toEqual([])
    expect(agent).not.toHaveBeenCalled()
  })

  it('keeps a damaged file beside it and starts over', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path.join(dir, 'summaries.json'), '{not json')
    const { s } = make({}, merged)
    s.committed(before, merged)
    await s.settled()
    expect(JSON.parse(await readFile(path.join(dir, 'summaries.json'), 'utf8')).summaries).toHaveLength(1)
  })
})
