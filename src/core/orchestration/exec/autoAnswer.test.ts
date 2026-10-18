// T21 (owner, 2026-10-18): Astera answers the Gates it safely can, from Host state first, else the safe default, through
// questions-answer with one feed line; the owner's kinds of question stay open; the setting turns it all off.
import { describe, expect, it } from 'vitest'
import { autoAnswerOf, autoAnswerOnOf, type OpenQuestion } from './autoAnswer'
import { createDispatchLoop, ORCH_FIRE_TICK_MS, type DispatchLoopContext } from './dispatchLoop'
import { handleCommand, type OrchServerDeps } from '../command'
import { createGate, emptyState, type OrchState } from '../state'
import type { ActivityDraft } from '../activity'
import type { Task } from '../types'

const NOW = '2026-10-18T00:00:00.000Z'
const T0 = Date.parse(NOW)

const task = (over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
  runId: 'run_1',
  spec: 's',
  deps: [],
  status: 'blocked',
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})
const base = (tasks: Task[]): OrchState => ({ ...emptyState(), tasks })
const q = (question: string, over: Partial<OpenQuestion> = {}): OpenQuestion => ({ id: 'gat_1', runId: 'run_1', taskId: 'tsk_x', question, createdAt: NOW, ...over })

describe('autoAnswerOf', () => {
  const s = base([task({ id: 'tsk_x', title: 'W9-B · Inbox' }), task({ id: 'tsk_a', title: 'W9-A · Coordinator answers', status: 'dispatched' })])

  it('a named safe default: "say go or hold" while W9-A has not merged is hold, from Host state', () => {
    expect(autoAnswerOf(s, q('Hold tsk_x until W9-A merges? say go or hold'))).toEqual({ id: 'gat_1', answer: 'hold', why: 'Host state' })
  })

  it('merge state from the Host: once W9-A merged the same question is go', () => {
    const merged = base([s.tasks[0], { ...s.tasks[1], status: 'completed', mergedIntoPlanAt: NOW }])
    expect(autoAnswerOf(merged, q('Hold until W9-A merges?', { options: ['go', 'hold'] }))?.answer).toBe('go')
  })

  it('a wave question with no options is answered with the facts', () => {
    const a = autoAnswerOf(s, q('Is wave W9 done yet?'))
    expect(a?.why).toBe('Host state')
    expect(a?.answer).toContain('W9-A (tsk_a) is dispatched')
    expect(a?.answer).toContain('Hold until it is.')
  })

  it('the safe default in order: the asker\'s recommendation, else hold, wait, retry, skip-check', () => {
    expect(autoAnswerOf(s, q('Base it on main or on the plan branch? I recommend plan-branch.', { options: ['main', 'plan-branch'] }))).toMatchObject({ answer: 'plan-branch', why: 'asked-for default' })
    expect(autoAnswerOf(s, q('Next?', { options: ['proceed', 'wait'] }))).toMatchObject({ answer: 'wait', why: 'safe default' })
    expect(autoAnswerOf(s, q('Checks failed', { options: ['retry-once', 'mark-failed'], kind: 'convergence-exhausted' }))?.answer).toBe('retry-once')
    expect(autoAnswerOf(s, q('lint could not run', { options: ['retry', 'skip-check', 'mark-failed'], kind: 'check-unavailable' }))?.answer).toBe('retry')
    // retry once means once: after a retry the next safe answer
    expect(autoAnswerOf(s, q('lint could not run', { options: ['retry', 'skip-check', 'mark-failed'], kind: 'check-unavailable' }), true)?.answer).toBe('skip-check')
    expect(autoAnswerOf(s, q('Checks failed again', { options: ['retry-once', 'mark-failed'], kind: 'convergence-exhausted' }), true)).toBeNull()
    expect(autoAnswerOf(s, q('Which colour should the button be?'))).toBeNull()
  })

  it('deleting, the default branch, money, credentials, permissions and "ask me" stay with the owner', () => {
    for (const text of [
      'Delete the old worktree? hold or go',
      'Push the plan branch to main now? hold or go',
      'Merge into master? wait or go',
      'This needs a paid plan ($20). wait or buy',
      'The API key expired; wait or rotate the token?',
      'Grant the worker sudo permission? hold or allow',
      'Hold or go? ask me before anything'
    ])
      expect(autoAnswerOf(s, q(text)), text).toBeNull()
    expect(autoAnswerOf(s, q('Next?', { options: ['delete-branch (recommended)', 'cancel'] }))).toBeNull()
    const askMe = base([task({ id: 'tsk_x', title: 'T1', spec: 'Ask me before choosing.' })])
    expect(autoAnswerOf(askMe, q('hold or go?'))).toBeNull()
  })

  it('the setting is on unless it says false', () => {
    expect(autoAnswerOnOf(undefined)).toBe(true)
    expect(autoAnswerOnOf('no')).toBe(true)
    expect(autoAnswerOnOf(false)).toBe(false)
  })
})

/** The loop's tick over the real command layer, with one Gate open. */
async function rig(question: string, options: string[] | undefined, on = true) {
  let state: OrchState = emptyState()
  let clock = T0
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    now: () => new Date(clock).toISOString()
  } as unknown as OrchServerDeps
  const handle = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: '' }, cmd, args)
  await handle('run-create', { objective: 'o', cwd: '/p' })
  await handle('task-create', { spec: 's', account: 'acc1', title: 'W9-B · Inbox' })
  await handle('task-create', { spec: 's', account: 'acc1', title: 'W9-A · Coordinator answers' })
  const made = createGate(state, { taskId: state.tasks[0].id, question, ...(options ? { options } : {}) }, NOW)
  if (!made.ok) throw new Error(made.error)
  state = made.state
  const lines: ActivityDraft[] = []
  const ctx = {
    handle,
    getState: () => state,
    accounts: () => [],
    loginStatus: async () => true,
    lang: () => 'en',
    sessionAlive: () => false,
    sessionBusy: () => null,
    typeInto: () => {},
    autoAnswer: () => on,
    activity: (d: ActivityDraft) => lines.push(d),
    mayStart: () => true,
    log: () => {},
    nowMs: () => clock
  } as unknown as DispatchLoopContext
  const loop = createDispatchLoop(ctx)
  return {
    gate: made.value,
    lines,
    gateNow: () => state.gates.find((g) => g.id === made.value.id),
    tick: async () => {
      clock += ORCH_FIRE_TICK_MS
      await loop.nudge()
    }
  }
}

describe('the Host answers on its tick', () => {
  it('a Gate naming a safe default is answered within 60 s, with one feed line', async () => {
    const r = await rig('Hold it until W9-A merges? say go or hold', undefined)
    await r.tick()
    expect(r.gateNow()).toMatchObject({ status: 'resolved', resolution: 'hold' })
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({ type: 'question.auto-answered', payload: { reason: 'Auto-answered: hold — W9-B · Inbox (Host state)' } })
    await r.tick()
    expect(r.lines).toHaveLength(1)
  })

  it('a Gate about merge state is answered from Host state', async () => {
    const r = await rig('Has W9-A merged yet?', undefined)
    await r.tick()
    expect(r.gateNow()?.status).toBe('resolved')
    expect(r.gateNow()?.resolution).toMatch(/^Host state: W9-A \(tsk_\w+\) is ready/)
  })

  it('a Gate that pushes to the default branch stays open for the owner', async () => {
    const r = await rig('Push to main now?', ['hold', 'push'])
    await r.tick()
    expect(r.gateNow()?.status).toBe('open')
    expect(r.lines).toEqual([])
  })

  it('with the setting off nothing is answered', async () => {
    const r = await rig('Hold it? say go or hold', undefined, false)
    await r.tick()
    expect(r.gateNow()?.status).toBe('open')
  })
})
