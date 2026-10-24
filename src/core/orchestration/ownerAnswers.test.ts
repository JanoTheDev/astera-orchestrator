// W8-F (#98, #100): an owner's answer is matched to the Gate's option however it is typed, and an answer that narrows a
// Task reaches its criteria (task-update) and its review brief.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { createGate, emptyState, OWNER_ANSWER_SUBJECT, type OrchState } from './state'
import { editPlanTask } from './planner'
import { ownerAnswersOf } from './reviewer'
import { buildReviewSpecFile } from './exec/coordinator'
import type { Message, Task } from './types'
import { unattendedQuestions } from './inbox'

const NOW = '2026-10-18T00:00:00.000Z'

const rig = () => {
  let state: OrchState = emptyState()
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    startWorker: async () => ({ sessionId: 'sess1', cwd: '/w', specPath: '/s.md' }),
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    readWorker: async () => '',
    now: () => NOW
  } as unknown as OrchServerDeps
  const call = (cmd: string, args: Record<string, unknown> = {}) => handleCommand(deps, { sessionId: '' }, cmd, args)
  return { deps, call, state: () => state, set: (s: OrchState) => (state = s) }
}

/** A Run with one Task and a Gate open on it. */
async function gated(kind?: 'convergence-exhausted') {
  const r = rig()
  await r.call('run-create', { objective: 'o', cwd: '/p' })
  await r.call('task-create', { spec: 's', account: 'acc1' })
  const task = r.state().tasks[0]
  const made = createGate(r.state(), { taskId: task.id, question: 'Base on main?', options: kind ? ['retry-once', 'mark-failed'] : ['alpha', 'beta'], ...(kind ? { kind } : {}) }, NOW)
  if (!made.ok) throw new Error(made.error)
  r.set(made.state)
  return { r, task, gate: made.value }
}

describe('W8-F (#98) questions answer matches the option however it is typed', () => {
  it('an option with stdin\'s newline and another case is the option, not free text', async () => {
    const { r, gate } = await gated()
    expect((await r.call('questions-answer', { id: gate.id, answer: ' BETA\n' })).status).toBe(200)
    expect(r.state().gates.find((g) => g.id === gate.id)).toMatchObject({ status: 'resolved', resolution: 'beta' })
  })

  it('the convergence Gate: "Mark-Failed\\n" fails the Task instead of sending it back to ready', async () => {
    const { r, task, gate } = await gated('convergence-exhausted')
    expect((await r.call('questions-answer', { id: gate.id, answer: 'Mark-Failed\n' })).status).toBe(200)
    expect(r.state().gates.find((g) => g.id === gate.id)?.resolution).toBe('mark-failed')
    expect(r.state().tasks.find((t) => t.id === task.id)?.status).toBe('failed')
  })

  it('free text stays free text, trimmed', async () => {
    const { r, gate } = await gated()
    await r.call('questions-answer', { id: gate.id, answer: '  base on main, skip F7\n' })
    expect(r.state().gates.find((g) => g.id === gate.id)?.resolution).toBe('base on main, skip F7')
  })
})

describe('W8-F (#100) the owner narrows a Task', () => {
  it('a Task in a run that has not finished takes new criteria, and nothing else', async () => {
    const { r, task } = await gated()
    const s = r.state()
    expect(task.runId).toBeDefined()
    const ok = editPlanTask(s, task.id, { acceptanceCriteria: ['F3 works'] }, NOW)
    expect(ok.ok && ok.value.acceptanceCriteria).toEqual(['F3 works'])
    expect(editPlanTask(s, task.id, { prompt: 'x' }, NOW).ok).toBe(false)
    const done: OrchState = { ...s, tasks: s.tasks.map((t): Task => (t.id === task.id ? { ...t, status: 'completed' } : t)) }
    expect(editPlanTask(done, task.id, { acceptanceCriteria: ['x'] }, NOW).ok).toBe(false)
  })

  it('the coordinator\'s task-update --criteria reaches the Task', async () => {
    const { r, task } = await gated()
    expect((await r.call('task-update', { id: task.id, criteria: ['F3 works'] })).status).toBe(200)
    expect(r.state().tasks.find((t) => t.id === task.id)?.acceptanceCriteria).toEqual(['F3 works'])
  })

  it('the review brief carries the owner\'s answers on that Task, a Gate and an escalation, and no one else\'s', async () => {
    const { r, task, gate } = await gated()
    await r.call('questions-answer', { id: gate.id, answer: 'base on main, skip the minus-sign change (F7)' })
    const asked: Message = { id: 'msg_e', runId: task.runId!, type: 'escalation', taskId: task.id, subject: 'Keep F7?', body: '', answered: true, answerBody: 'drop F7', createdAt: NOW }
    const copy: Message = { id: 'msg_c', runId: task.runId!, type: 'status', taskId: task.id, subject: OWNER_ANSWER_SUBJECT, body: 'drop F7\n\nThe worker no longer waits', replyTo: 'msg_e', answered: true, createdAt: '2026-10-18T00:00:01.000Z' }
    const other: Message = { ...copy, id: 'msg_o', taskId: 'tsk_other', body: 'unrelated' }
    r.set({ ...r.state(), messages: [...r.state().messages, asked, copy, other] })
    const answers = ownerAnswersOf(r.state(), task.id)
    expect(answers).toEqual(['Base on main? → base on main, skip the minus-sign change (F7)', 'Keep F7? → drop F7'])
    const brief = buildReviewSpecFile({ title: 'T', spec: 's', taskId: task.id, dispatchId: 'dsp_1', validated: false, ownerAnswers: answers })
    expect(brief).toContain("## The owner's answers on this task")
    expect(brief).toContain('1. Base on main? → base on main, skip the minus-sign change (F7)')
    expect(brief).toContain('2. Keep F7? → drop F7')
    expect(brief).not.toContain('unrelated')
    // no answers, no section
    expect(buildReviewSpecFile({ title: 'T', spec: 's', taskId: task.id, dispatchId: 'dsp_1', validated: false })).not.toContain("owner's answers")
  })
})

// A Task held for its owner (blocked, no Gate) moves on once the owner answers the last question left open on it
describe('the owner answering a held Task’s last question releases it', () => {
  const held = async (open: Array<Pick<Message, 'id' | 'type'>>) => {
    const r = rig()
    await r.call('run-create', { objective: 'o', cwd: '/p' })
    await r.call('task-create', { spec: 's', account: 'acc1' })
    const s = r.state()
    const task = s.tasks[0]
    const ask = (m: Pick<Message, 'id' | 'type'>): Message => ({ ...m, runId: task.runId!, taskId: task.id, subject: 'Delete the old runs?', body: 'Delete the old runs?', answered: false, createdAt: NOW })
    r.set({ ...s, tasks: [{ ...task, status: 'blocked' }], messages: [...s.messages, ...open.map(ask)] })
    return { r, task }
  }

  it('an escalation: the Task goes to ready, and stays blocked while another question of it is open', async () => {
    const { r, task } = await held([{ id: 'msg_e1', type: 'escalation' }, { id: 'msg_e2', type: 'escalation' }])
    expect((await r.call('questions-answer', { id: 'msg_e1', answer: 'yes' })).status).toBe(200)
    expect(r.state().tasks.find((t) => t.id === task.id)?.status).toBe('blocked')
    expect((await r.call('questions-answer', { id: 'msg_e2', answer: 'yes' })).status).toBe(200)
    expect(r.state().tasks.find((t) => t.id === task.id)?.status).toBe('ready')
  })

  it("a worker's question the owner answers releases it too; a coordinator's answer does not", async () => {
    const { r, task } = await held([{ id: 'msg_q1', type: 'question' }])
    await handleCommand(r.deps, { sessionId: 'coord_1' }, 'questions-answer', { id: 'msg_q1', answer: 'yes' })
    expect(r.state().tasks.find((t) => t.id === task.id)?.status).toBe('blocked')
    const again = await held([{ id: 'msg_q1', type: 'question' }])
    await again.r.call('questions-answer', { id: 'msg_q1', answer: 'yes' })
    expect(again.r.state().tasks.find((t) => t.id === again.task.id)?.status).toBe('ready')
  })

  it('a Task blocked on an open Gate stays blocked: only resolveGate moves it', async () => {
    const { r, task } = await held([{ id: 'msg_e1', type: 'escalation' }])
    const made = createGate({ ...r.state(), tasks: r.state().tasks.map((t) => ({ ...t, status: 'ready' as const })) }, { taskId: task.id, question: 'Base on main?' }, NOW)
    if (!made.ok) throw new Error(made.error)
    r.set(made.state)
    await r.call('questions-answer', { id: 'msg_e1', answer: 'yes' })
    expect(r.state().tasks.find((t) => t.id === task.id)?.status).toBe('blocked')
  })
})

// T4: a worker that needs an owner-only command asks the owner for it; approving runs exactly that command as the app
describe('a worker asks the owner to run an owner-only command', () => {
  const working = async () => {
    const r = rig()
    await r.call('run-create', { objective: 'o', cwd: '/p' })
    await r.call('task-create', { spec: 's', account: 'acc1' })
    const task = r.state().tasks[0]
    expect((await r.call('worker-start', { taskId: task.id, agent: 'claude', account: 'acc1', worktree: 'current' })).status).toBe(200)
    const jobId = r.state().jobs[0].id
    const worker = (cmd: string, args: Record<string, unknown>) => handleCommand(r.deps, { sessionId: 'sess1' }, cmd, args)
    const asked = await worker('jobs-archive', { id: jobId })
    return { r, task, jobId, worker, asked, approvalId: (asked.body as { questionId: string }).questionId }
  }
  const archived = (r: ReturnType<typeof rig>, jobId: string) => r.state().jobs.find((j) => j.id === jobId)?.archivedAt !== undefined

  it('the worker gets a request id and how to wait, not PERMISSION_DENIED, and nothing runs yet', async () => {
    const { r, jobId, asked, approvalId } = await working()
    expect(asked.status).toBe(202)
    expect(asked.body).toMatchObject({ approvalRequested: true, questionId: expect.stringMatching(/^msg_/), command: `astera jobs archive --id ${jobId}` })
    expect(JSON.stringify(asked.body)).toContain(`astera ask --resume ${approvalId}`)
    expect(archived(r, jobId)).toBe(false)
    expect(r.state().messages.find((m) => m.id === approvalId)?.approval).toEqual({ cmd: 'jobs-archive', args: { id: jobId } })
    // A Run with no coordinator answers its worker's asks itself; never this one
    expect(unattendedQuestions(r.state(), () => false)).not.toContain(approvalId)
  })

  it('the same request again is the same approval; it does not block an ordinary ask', async () => {
    const { task, jobId, worker, approvalId } = await working()
    expect(((await worker('jobs-archive', { id: jobId })).body as { questionId: string }).questionId).toBe(approvalId)
    expect((await worker('ask', { taskId: task.id, question: 'Which base?', timeoutMs: 1 })).status).toBe(200)
  })

  it('approve replays the stored command as the app, and the worker\'s wait returns its result', async () => {
    const { r, jobId, worker, approvalId } = await working()
    const answered = await r.call('questions-answer', { id: approvalId, answer: 'approve' })
    expect(answered.status).toBe(200)
    expect(answered.body).toMatchObject({ status: 'resolved', result: { status: 200 } })
    expect(archived(r, jobId)).toBe(true)
    const waited = await worker('ask', { resume: approvalId, timeoutMs: 1 })
    expect(waited.body).toMatchObject({ answered: true })
    expect((waited.body as { answer: string }).answer).toMatch(/^Approved/)
    expect((waited.body as { answer: string }).answer).toContain('Result (200)')
  })

  it('deny runs nothing and the worker\'s wait returns the refusal', async () => {
    const { r, jobId, worker, approvalId } = await working()
    expect((await r.call('questions-answer', { id: approvalId, answer: 'deny' })).status).toBe(200)
    expect(archived(r, jobId)).toBe(false)
    expect(((await worker('ask', { resume: approvalId, timeoutMs: 1 })).body as { answer: string }).answer).toMatch(/^Denied/)
  })

  it('an agent session answering it gets 403, and a coordinator reply is refused too', async () => {
    const { r, jobId, approvalId } = await working()
    expect((await handleCommand(r.deps, { sessionId: 'coord_1' }, 'questions-answer', { id: approvalId, answer: 'approve' })).status).toBe(403)
    expect((await handleCommand(r.deps, { sessionId: '', role: 'mcp' }, 'questions-answer', { id: approvalId, answer: 'approve' })).status).toBe(403)
    expect((await r.call('reply', { id: approvalId, body: 'approve' })).status).toBeGreaterThanOrEqual(400)
    expect(archived(r, jobId)).toBe(false)
    expect(r.state().messages.find((m) => m.id === approvalId)?.answered).toBe(false)
  })

  it('an answer other than approve or deny is refused, and a second approve does not run it again', async () => {
    const { r, approvalId } = await working()
    expect((await r.call('questions-answer', { id: approvalId, answer: 'maybe' })).status).toBe(400)
    await r.call('questions-answer', { id: approvalId, answer: 'approve' })
    const again = await r.call('questions-answer', { id: approvalId, answer: 'approve' })
    expect(again.body).not.toHaveProperty('result')
  })

  it('questions list shows it as an approval; a worker with no open dispatch keeps the plain 403', async () => {
    const { r, approvalId } = await working()
    const listed = (await r.call('questions-list', { status: 'open' })).body as Array<{ id: string; source?: string; command?: string }>
    expect(listed.find((q) => q.id === approvalId)).toMatchObject({ source: 'approval', command: `astera jobs archive --id ${r.state().jobs[0].id}` })
    r.set({ ...r.state(), dispatches: r.state().dispatches.map((d) => ({ ...d, endedAt: NOW })) })
    expect((await handleCommand(r.deps, { sessionId: 'sess1' }, 'jobs-archive', { id: r.state().jobs[0].id })).status).toBe(403)
  })
})
