// T21 (owner, 2026-10-18): Astera answers the Gates it safely can, from Host state first, else the safe default, through
// questions-answer with one feed line; the owner's kinds of question stay open; the setting turns it all off.
import { describe, expect, it } from 'vitest'
import { STOPPED_DEP_OPTIONS } from '../overlap'
import { ASK_GRACE_MS, autoAnswersDue, autoAnswerOf, autoAnswerOnOf, coordinatorDecideBody, grantedAnswer, grantOf, handsOffStepsDue, REFUSED_ANSWER, type OpenQuestion } from './autoAnswer'
import { createDispatchLoop, ORCH_FIRE_TICK_MS, type DispatchLoopContext } from './dispatchLoop'
import { handleCommand, type OrchServerDeps } from '../command'
import { addDecision, createGate, emptyState, type OrchState } from '../state'
import { deriveActivity, noticeOf, type ActivityDraft } from '../activity'
import { heldForOwner, outcomeOf } from '../running'
import type { Task } from '../types'
import { FAILED_WAIT_OPTIONS } from '../replan'

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
async function rig(question: string, options: string[] | undefined, on = true, o: { handsOff?: boolean; kind?: 'convergence-exhausted'; escalation?: boolean } = {}) {
  let state: OrchState = emptyState()
  let clock = T0
  // Every commit, so the feed can be derived the way the Host does: one commit at a time
  const commits: OrchState[] = []
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
      commits.push(next)
    },
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    now: () => new Date(clock).toISOString()
  } as unknown as OrchServerDeps
  const handle = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: '' }, cmd, args)
  await handle('run-create', { objective: 'o', cwd: '/p' })
  await handle('task-create', { spec: 's', account: 'acc1', title: 'W9-B · Inbox' })
  await handle('task-create', { spec: 's', account: 'acc1', title: 'W9-A · Coordinator answers' })
  if (o.handsOff) state = { ...state, jobs: state.jobs.map((j) => ({ ...j, handsOff: true })) }
  // `escalation`: a worker's escalation on the first Task, past its grace, instead of the Gate
  const made = o.escalation
    ? { ok: true as const, state: { ...state, messages: [...state.messages, { id: 'msg_esc', runId: state.runs[0].id, type: 'escalation' as const, taskId: state.tasks[0].id, subject: question, body: question, ...(options ? { options } : {}), answered: false, createdAt: new Date(T0 - ASK_GRACE_MS).toISOString() }] }, value: { id: 'msg_esc' } }
    : createGate(state, { taskId: state.tasks[0].id, question, ...(options ? { options } : {}), ...(o.kind ? { kind: o.kind } : {}) }, NOW)
  if (!made.ok) throw new Error(made.error)
  state = made.state
  const lines: ActivityDraft[] = []
  const before = state
  const mark = commits.length
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
    recordDecision: async (jobId: string, d: Parameters<typeof addDecision>[2]) => {
      state = addDecision(state, jobId, d)
      commits.push(state)
    },
    mayStart: () => true,
    log: () => {},
    nowMs: () => clock
  } as unknown as DispatchLoopContext
  const loop = createDispatchLoop(ctx)
  return {
    gate: made.value,
    lines,
    gateNow: () => state.gates.find((g) => g.id === made.value.id),
    handle,
    state: () => state,
    before,
    /** The feed lines of every commit since the rig was built, each derived from the commit before it. */
    feed: () => {
      const chain = [before, ...commits.slice(mark)]
      return chain.slice(1).flatMap((next, i) => deriveActivity(chain[i], next))
    },
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

describe('hands-off plans decide for the owner (#117)', () => {
  const s = base([task({ id: 'tsk_x', title: 'T1 · Login' })])

  it('T36: never answers, nor hands to a coordinator, the question over a failed Task that holds back the plan', () => {
    const failedWait = q('Plan: 2 Tasks wait on failed T1 · Login: no network', {
      source: 'escalation',
      options: [...FAILED_WAIT_OPTIONS],
      createdAt: new Date(T0 - 10 * ASK_GRACE_MS).toISOString()
    })
    expect(handsOffStepsDue(s, [failedWait], T0)).toEqual([])
    expect(autoAnswersDue(s, [failedWait], T0)).toEqual([])
  })

  it("T4: a worker's request to run an owner-only command is never answered, held, nor handed to a coordinator", () => {
    const old = new Date(T0 - 10 * ASK_GRACE_MS).toISOString()
    // Words a guardrail refuses (`jobs archive`, delete) and options a safe default would pick
    const approval = q('The worker asks to run `astera jobs archive --id job_1` and delete the old runs. Approve or deny.', { source: 'approval', options: ['approve', 'deny'], createdAt: old })
    const plain = q('The worker asks to run `astera inbox`. Approve or deny.', { source: 'approval', options: ['approve', 'deny'], createdAt: old })
    expect(handsOffStepsDue(s, [approval, plain], T0)).toEqual([])
    expect(autoAnswersDue(s, [approval, plain], T0)).toEqual([])
  })
  const exhausted = q('Checks failed 3 times', { kind: 'convergence-exhausted', options: ['retry-once', 'mark-failed'] })

  it('an exhausted Gate is answered retry-once, then mark-failed once its Task was retried', () => {
    expect(handsOffStepsDue(s, [exhausted], T0)).toEqual([
      { kind: 'answer', answer: { id: 'gat_1', answer: 'retry-once', why: 'safe default' }, decision: expect.objectContaining({ kind: 'gate', taskId: 'tsk_x', choice: 'retry-once' }) }
    ])
    const retried: OrchState = { ...s, gates: [{ id: 'gat_0', runId: 'run_1', taskId: 'tsk_x', question: 'q', status: 'resolved', resolution: 'retry-once', createdAt: NOW }] }
    expect(handsOffStepsDue(retried, [exhausted], T0)).toEqual([
      { kind: 'answer', answer: expect.objectContaining({ answer: 'mark-failed' }), decision: expect.objectContaining({ kind: 'gate', choice: 'mark-failed' }) }
    ])
  })

  it("a question Astera asked itself is judged by its options, not by the Task titles in its text", () => {
    const stopped = q('"Remove the All consoles wall" (plan P) waits on "Visual check" of plan W, whose plan stopped. Keep waiting, drop this dependency, or cancel this Task? [dep tsk_d]', {
      options: [...STOPPED_DEP_OPTIONS]
    })
    expect(handsOffStepsDue(s, [stopped], T0)).toEqual([
      { kind: 'answer', answer: { id: 'gat_1', answer: 'keep waiting', why: 'safe default' }, decision: expect.objectContaining({ kind: 'gate', choice: 'keep waiting' }) }
    ])
  })

  it('a guardrail case is refused, never asked: the refusal option, else the refusal written out', () => {
    expect(handsOffStepsDue(s, [q('Push the plan branch to main now?', { options: ['push', 'hold'] })], T0)).toEqual([
      {
        kind: 'answer',
        answer: expect.objectContaining({ answer: 'hold' }),
        decision: expect.objectContaining({ kind: 'refused', choice: 'hold' }),
        hold: { taskId: 'tsk_x', reason: "Waiting on the owner's decision: Push the plan branch to main now?" }
      }
    ])
    const esc = q('Force-push the branch over the rewrite?', { source: 'escalation', createdAt: new Date(T0 - ASK_GRACE_MS).toISOString() })
    // An escalation is the owner's question: left open, not answered with the refusal
    const live = base([task({ id: 'tsk_x', title: 'T1 · Login', status: 'dispatched' })])
    expect(handsOffStepsDue(live, [esc], T0)).toEqual([
      { kind: 'hold', id: 'gat_1', decision: expect.objectContaining({ kind: 'refused', choice: REFUSED_ANSWER.slice(0, 197) + '...' }), hold: expect.objectContaining({ taskId: 'tsk_x' }) }
    ])
    // Once its Task is held (blocked, no Gate), it is the owner's alone: not refused again
    expect(handsOffStepsDue(s, [esc], T0)).toEqual([])
  })

  it('an escalation with no safe answer waits out the grace, then goes to the coordinator', () => {
    const esc = q('Which colour should the button be?', { id: 'msg_1', source: 'escalation' })
    expect(handsOffStepsDue(s, [esc], T0)).toEqual([])
    expect(handsOffStepsDue(s, [esc], T0 + ASK_GRACE_MS)).toEqual([{ kind: 'coordinator', question: esc }])
  })

  it('the loop answers with the global setting off, records the decision, and the feed says "Decided for you"', async () => {
    const r = await rig('Checks failed 3 times', ['retry-once', 'mark-failed'], false, { handsOff: true, kind: 'convergence-exhausted' })
    await r.tick()
    expect(r.gateNow()).toMatchObject({ status: 'resolved', resolution: 'retry-once' })
    expect(r.state().jobs[0].decisions).toEqual([expect.objectContaining({ kind: 'gate', choice: 'retry-once', why: 'the attempts ran out: one more try' })])
    // The decision's own feed line, not a question.auto-answered one
    expect(r.lines).toEqual([])
    const derived = deriveActivity(r.before, r.state()).filter((l) => l.type.startsWith('plan.'))
    expect(derived).toEqual([expect.objectContaining({ type: 'plan.decided', payload: expect.objectContaining({ handsOff: true, reason: expect.stringMatching(/^Decided for you: retry-once — W9-B · Inbox/) }) })])
  })

  it('the loop refuses a guardrail Gate on a hands-off plan: kind refused and a plan.refused line', async () => {
    const r = await rig('Push to main now?', ['hold', 'push'], true, { handsOff: true })
    await r.tick()
    expect(r.gateNow()).toMatchObject({ status: 'resolved', resolution: 'hold' })
    expect(r.state().jobs[0].decisions).toEqual([expect.objectContaining({ kind: 'refused', choice: 'hold' })])
    expect(deriveActivity(r.before, r.state()).filter((l) => l.type.startsWith('plan.'))).toEqual([expect.objectContaining({ type: 'plan.refused', payload: expect.objectContaining({ reason: expect.stringMatching(/^Refused: Push to main now\?/) }) })])
  })
})

// Item 2: the refusal holds the Task that needs the decision, and the rest of the plan goes on
describe('a hands-off refusal holds its Task', () => {
  it('blocks just that Task with its reason and no Gate, with one owner notice, and the other Task still runs', async () => {
    const r = await rig('Drop the legacy table for the protected migration?', ['hold', 'run it'], true, { handsOff: true })
    const [held, other] = r.state().tasks
    await r.tick()
    expect(r.gateNow()).toMatchObject({ status: 'resolved', resolution: 'hold' })
    const now = r.state().tasks.find((t) => t.id === held.id)!
    expect(now).toMatchObject({ status: 'blocked', result: "Waiting on the owner's decision: Drop the legacy table for the protected migration?" })
    expect(heldForOwner(now, r.state().gates)).toBe(true)
    expect(r.state().tasks.find((t) => t.id === other.id)?.status).toBe('ready')
    expect(outcomeOf(r.state(), now.runId!)).toBe('running')
    const notices = r.feed().map((l, i) => noticeOf({ ...l, id: `ev_${i}`, sequence: i, occurredAt: NOW })).filter((n) => n !== null)
    expect(notices).toEqual([expect.objectContaining({ title: 'Needs your decision', body: expect.stringContaining('Waiting on the owner') })])
    // Answered once: the next passes neither block it again nor tell the owner again
    await r.tick()
    await r.tick()
    expect(r.feed().map((l, i) => noticeOf({ ...l, id: `ev_${i}`, sequence: i, occurredAt: NOW })).filter((n) => n !== null)).toHaveLength(1)
  })

  it("an escalation refused for the owner stays open, and the owner's answer moves the held Task to ready", async () => {
    const r = await rig('Run jobs-archive and delete the old runs?', undefined, true, { handsOff: true, escalation: true })
    const held = r.state().tasks[0]
    await r.tick()
    await r.tick()
    expect(r.state().messages.find((m) => m.id === 'msg_esc')).toMatchObject({ answered: false })
    expect(r.state().tasks[0]).toMatchObject({ status: 'blocked', result: "Waiting on the owner's decision: Run jobs-archive and delete the old runs?" })
    expect(r.state().jobs[0].decisions).toEqual([expect.objectContaining({ kind: 'refused', taskId: held.id })])
    const answered = await r.handle('questions-answer', { id: 'msg_esc', answer: 'yes, run it' })
    expect(answered.status).toBe(200)
    expect(r.state().tasks[0].status).toBe('ready')
    // The answer is the status line the next Dispatch's briefing carries
    expect(r.state().messages.filter((m) => m.taskId === held.id && m.type === 'status').at(-1)?.body).toContain('Answer: yes, run it')
  })
})

// T5: a standing grant (`projects set --grants`) lets the coordinator write a covered grant itself
describe('standing grants on a hands-off plan', () => {
  const planned = (grants?: string[]): OrchState => ({
    ...base([task({ id: 'tsk_x', title: 'T1 · Schema', status: 'dispatched' })]),
    projects: [{ id: 'prj_1', path: 'D:/p', name: 'p', addedAt: NOW, ...(grants ? { grants } : {}) }],
    jobs: [{ id: 'job_1', objective: 'o', cwd: 'D:/p', projectId: 'prj_1', createdAt: NOW } as OrchState['jobs'][number]],
    runs: [{ id: 'run_1', jobId: 'job_1' } as OrchState['runs'][number]]
  })
  const esc = q('The protected migration needs a grant per CLAUDE.md. Grant it?', { source: 'escalation', createdAt: new Date(T0 - ASK_GRACE_MS).toISOString() })

  it('grantOf matches the kind word and its synonyms, and nothing else', () => {
    expect(grantOf(['migrations'], 'run the migration')).toBe('migrations')
    expect(grantOf(['protected-paths'], 'touch a protected file')).toBe('protected-paths')
    expect(grantOf(['schema-changes'], 'needs schema changes')).toBe('schema-changes')
    expect(grantOf(['migrations'], 'push to main')).toBeUndefined()
    expect(grantOf(undefined, 'run the migration')).toBeUndefined()
  })

  it('a migration escalation on a project granting migrations is answered back with the grant to write, not refused', () => {
    expect(handsOffStepsDue(planned(['migrations']), [esc], T0)).toEqual([
      { kind: 'answer', answer: { id: 'gat_1', answer: grantedAnswer('migrations'), why: 'Host state' }, decision: expect.objectContaining({ kind: 'escalation', why: 'the owner granted migrations in advance' }) }
    ])
  })

  it('without the grant, or when it also deletes data, the Task is still held for the owner', () => {
    expect(handsOffStepsDue(planned(), [esc], T0)).toEqual([expect.objectContaining({ decision: expect.objectContaining({ kind: 'refused' }), hold: expect.objectContaining({ taskId: 'tsk_x' }) })])
    expect(handsOffStepsDue(planned(['protected-paths']), [q('Grant the migration?', { source: 'escalation', createdAt: esc.createdAt })], T0)).toEqual([
      expect.objectContaining({ hold: expect.objectContaining({ taskId: 'tsk_x' }) })
    ])
    const drop = q('Grant dropping the legacy table in the migration?', { source: 'escalation', createdAt: esc.createdAt })
    expect(handsOffStepsDue(planned(['migrations']), [drop], T0)).toEqual([expect.objectContaining({ hold: expect.objectContaining({ taskId: 'tsk_x' }) })])
  })
})

describe('a review-needs-decision Gate on a hands-off plan', () => {
  const planned = (grants?: string[]): OrchState => ({
    ...base([task({ id: 'tsk_x', title: 'T1 · Login', status: 'dispatched' })]),
    projects: [{ id: 'prj_1', path: 'D:/p', name: 'p', addedAt: NOW, ...(grants ? { grants } : {}) }],
    jobs: [{ id: 'job_1', objective: 'o', cwd: 'D:/p', projectId: 'prj_1', createdAt: NOW } as OrchState['jobs'][number]],
    runs: [{ id: 'run_1', jobId: 'job_1' } as OrchState['runs'][number]]
  })
  const gate = (text: string): OpenQuestion => q(text, { kind: 'review-needs-decision' })

  it('goes to the coordinator, whose message asks to extend scope, grant or pick an option', () => {
    const g = gate('The review needs a running dev server to check the settings page.')
    expect(handsOffStepsDue(planned(), [g], T0)).toEqual([{ kind: 'coordinator', question: g }])
    const body = coordinatorDecideBody(g)
    expect(body).toContain('no code change fixes')
    expect(body).toMatch(/extend the Task's scope/)
    expect(body).toMatch(/grant the standing permission/)
    expect(body).toMatch(/pick an option/)
    expect(body).toContain('verbatim')
    expect(body).toContain('astera questions answer --id gat_1')
  })

  it('is answered with the grant when a project grant covers its text', () => {
    const g = gate('The review needs a running dev server to check the settings page.')
    expect(handsOffStepsDue(planned(['dev-server']), [g], T0)).toEqual([
      { kind: 'answer', answer: { id: 'gat_1', answer: grantedAnswer('dev-server'), why: 'Host state' }, decision: expect.objectContaining({ kind: 'gate', why: 'the owner granted dev-server in advance' }) }
    ])
  })

  it('holds its Task for the owner when the text hits a guardrail, a grant or not', () => {
    const g = gate('The review needs the production credentials and a dev-server.')
    for (const s of [planned(), planned(['dev-server'])]) {
      expect(handsOffStepsDue(s, [g], T0)).toEqual([
        expect.objectContaining({ kind: 'hold', id: 'gat_1', decision: expect.objectContaining({ kind: 'refused', taskId: 'tsk_x' }), hold: expect.objectContaining({ taskId: 'tsk_x' }) })
      ])
    }
  })

  it('has no safe default for the global auto-answer', () => {
    expect(autoAnswerOf(planned(), gate('The review needs a running dev server.'))).toBeNull()
    expect(autoAnswerOf(planned(), gate('The review needs a decision. Options are open.'))).toBeNull()
  })
})
