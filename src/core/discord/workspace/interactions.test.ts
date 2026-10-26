import { describe, it, expect, vi } from 'vitest'
import { emptyState, type OrchState } from '../../orchestration/state'
import type { Gate, Job, JobRun } from '../../orchestration/types'
import { DiscordApiError, type MessageBody } from '../rest'
import { customId } from './ids'
import { APPROVE_WORDS, handleInteraction, handlePlanMessage, planWorkspace, type Handle, type WorkspaceDeps } from './interactions'

const OWNER = '111111111111111111'
const STRANGER = '222222222222222222'

const job = (over: Partial<Job> = {}): Job => ({ id: 'job_1', objective: 'Ship it', cwd: '/repo', createdAt: 'x', ...over })
const gate: Gate = { id: 'gat_1', runId: 'run_1', taskId: 'tsk_1', question: 'Which way?', options: ['Left', 'Right'], status: 'open', createdAt: 'x' }
const baseState = (): OrchState => ({
  ...emptyState(),
  jobs: [job({ pendingStart: true, plannerSessionIds: ['s1'] }), job({ id: 'job_2', title: 'Running one' })],
  runs: [{ id: 'run_1', jobId: 'job_2', ordinal: 1, createdAt: 'x' } as JobRun],
  gates: [gate],
  projects: [{ id: 'prj_1', path: '/repo', name: 'Repo', addedAt: 'x' }]
})

function fakeRest() {
  let n = 0
  return {
    postMessage: vi.fn(async (channel_id: string, _m: MessageBody) => ({ id: `msg_${++n}`, channel_id, content: '' })),
    editMessage: vi.fn(async (channel_id: string, id: string, _m: MessageBody) => ({ id, channel_id, content: '' })),
    pinMessage: vi.fn(async (_c: string, _m: string) => undefined),
    interactionCallback: vi.fn(async (_id: string, _token: string, _r: { type: number; data?: Record<string, unknown> }) => undefined),
    editOriginalInteraction: vi.fn(async (_app: string, _token: string, _m: MessageBody) => ({ id: 'orig', channel_id: 'c', content: '' })),
    bulkOverwriteGuildCommands: vi.fn(async (_a: string, _g: string, _c: unknown[]) => [])
  }
}

function setup(over: { userId?: string | null; handle?: Handle; state?: OrchState } = {}) {
  const rest = fakeRest()
  const handle = vi.fn(over.handle ?? (async () => ({ status: 200, body: {} })))
  const changed: string[] = []
  const deps: WorkspaceDeps = {
    rest,
    handle,
    state: () => over.state ?? baseState(),
    cfg: () => ({ userId: over.userId === undefined ? OWNER : over.userId, guildId: 'g1' }),
    lang: () => 'en',
    channelOfPlan: (jobId) => (jobId === 'job_1' ? 'ch_plan1' : jobId === 'job_2' ? 'ch_plan2' : null),
    planOfChannel: (ch) => (ch === 'ch_plan1' ? 'job_1' : ch === 'ch_plan2' ? 'job_2' : null),
    projectOfChannel: (ch) => (ch === 'ch_plan1' || ch === 'ch_home_prj' ? 'prj_1' : null),
    log: () => undefined,
    onChanged: (id) => changed.push(id)
  }
  return { rest, handle, deps, changed }
}

const base = (userId: string, channel = 'ch_plan1') => ({ id: 'int_1', token: 'tok', application_id: 'app_1', channel_id: channel, member: { user: { id: userId } } })
const command = (sub: string, options?: unknown[], userId = OWNER, channel = 'ch_plan1') => ({
  ...base(userId, channel),
  type: 2,
  data: { name: 'plan', options: [{ type: 1, name: sub, ...(options ? { options } : {}) }] }
})
const component = (id: string, userId = OWNER, values?: string[]) => ({
  ...base(userId),
  type: 3,
  data: { custom_id: id, component_type: values ? 3 : 2, ...(values ? { values } : {}) }
})
const modal = (id: string, text: string, userId = OWNER) => ({
  ...base(userId),
  type: 5,
  data: { custom_id: id, components: [{ type: 1, components: [{ type: 4, custom_id: 'text', value: text }] }] }
})

const ALL_INTERACTIONS = (userId: string) => [
  command('status', undefined, userId),
  command('status', undefined, userId, 'ch_home'),
  command('approve', undefined, userId),
  command('approve', undefined, userId, 'ch_home'),
  command('new', [{ name: 'objective', value: 'Build it' }], userId),
  command('new', [{ name: 'objective', value: 'Build it' }], userId, 'ch_home'),
  command('nonsense', undefined, userId),
  component(customId({ action: 'approve', id: 'job_1' }), userId),
  component(customId({ action: 'gate', id: 'gat_1', n: 1 }), userId),
  component(customId({ action: 'gate', id: 'gat_1', n: 0 }), userId, ['1']),
  component(customId({ action: 'gate', id: 'gat_x', n: 0 }), userId),
  component(customId({ action: 'gate-other', id: 'gat_1' }), userId),
  component(customId({ action: 'feedback', id: 'job_1' }), userId),
  component('something:else', userId),
  modal(customId({ action: 'gate-other', id: 'gat_1' }), 'Up', userId),
  modal(customId({ action: 'feedback', id: 'job_1' }), 'More tests', userId),
  modal('bogus', 'x', userId),
  { ...base(userId), type: 4, data: { name: 'plan' } },
  { ...base(userId), type: 99 }
]

describe('the trust boundary', () => {
  for (const [label, userId, sender] of [
    ['another user', OWNER, STRANGER],
    ['anyone, with no owner set', null, OWNER]
  ] as const) {
    it(`${label}: every interaction runs no orch command and gets an ephemeral refusal`, async () => {
      for (const i of ALL_INTERACTIONS(sender)) {
        const { rest, handle, deps } = setup({ userId })
        await handleInteraction(i, deps)
        expect(handle).not.toHaveBeenCalled()
        expect(rest.interactionCallback).toHaveBeenCalledTimes(1)
        const [, , res] = rest.interactionCallback.mock.calls[0]
        expect(res.type).toBe(4)
        expect(res.data?.flags).toBe(64)
        expect(String(res.data?.content)).toContain('Only the owner')
      }
    })

    it(`${label}: a plan-channel message runs no orch command and gets no answer`, async () => {
      const { rest, handle, deps } = setup({ userId })
      await handlePlanMessage({ id: 'm1', channel_id: 'ch_plan1', content: 'do more', author: { id: sender } }, deps)
      expect(handle).not.toHaveBeenCalled()
      expect(rest.postMessage).not.toHaveBeenCalled()
    })
  }
})

describe('every interaction is answered', () => {
  const outcomes: Array<[string, Handle]> = [
    ['succeeds', async (cmd) => ({ status: 200, body: cmd === 'jobs-create' ? { id: 'job_9', objective: 'Build it' } : {} })],
    ['is refused', async () => ({ status: 409, body: { error: 'nope, said the Host' } })],
    ['throws', async () => { throw new Error('boom at /secret/stack.ts:1') }]
  ]
  for (const [label, impl] of outcomes) {
    it(`when the Host ${label}`, async () => {
      for (const i of ALL_INTERACTIONS(OWNER)) {
        const { rest, deps } = setup({ handle: impl })
        await handleInteraction(i, deps)
        expect(rest.interactionCallback, JSON.stringify(i)).toHaveBeenCalledTimes(1)
        const type = rest.interactionCallback.mock.calls[0][2].type
        expect([4, 5, 6, 8, 9]).toContain(type)
        // a deferred answer is always finished
        if (type === 5 || type === 6) expect(rest.editOriginalInteraction, JSON.stringify(i)).toHaveBeenCalled()
        for (const [, , m] of rest.editOriginalInteraction.mock.calls) expect(JSON.stringify(m)).not.toContain('stack.ts')
      }
    })
  }

  it('says the Host’s refusal text', async () => {
    const { rest, deps } = setup({ handle: async () => ({ status: 400, body: { error: 'the plan cannot be approved yet', problems: ['tsk_1 has no prompt'] } }) })
    await handleInteraction(component(customId({ action: 'approve', id: 'job_1' })), deps)
    const text = String(rest.editOriginalInteraction.mock.calls[0][2].content)
    expect(text).toContain('the plan cannot be approved yet')
    expect(text).toContain('tsk_1 has no prompt')
  })

  it('a failing defer is logged, not thrown', async () => {
    const { rest, deps, handle } = setup()
    rest.interactionCallback.mockRejectedValueOnce(new DiscordApiError(404, 10062))
    await expect(handleInteraction(component(customId({ action: 'approve', id: 'job_1' })), deps)).resolves.toBeUndefined()
    expect(handle).not.toHaveBeenCalled()
  })
})

describe('the orch commands the app uses', () => {
  it('Approve & execute: run-start on the Job, deferred first', async () => {
    const { rest, handle, deps, changed } = setup()
    await handleInteraction(component(customId({ action: 'approve', id: 'job_1' })), deps)
    expect(rest.interactionCallback.mock.calls[0][2].type).toBe(5)
    expect(handle.mock.calls).toEqual([['run-start', { run: 'job_1', ownerSaid: APPROVE_WORDS }]])
    expect(changed).toEqual(['job_1'])
  })

  it('/plan approve approves this channel’s plan, and refuses a plan not waiting for approval', async () => {
    const a = setup()
    await handleInteraction(command('approve'), a.deps)
    expect(a.handle.mock.calls).toEqual([['run-start', { run: 'job_1', ownerSaid: APPROVE_WORDS }]])

    const b = setup()
    await handleInteraction(command('approve', undefined, OWNER, 'ch_plan2'), b.deps)
    expect(b.handle).not.toHaveBeenCalled()
    expect(String(b.rest.editOriginalInteraction.mock.calls[0][2].content)).toContain('not waiting for approval')
  })

  it('a Gate option: gate-resolve with the option, then the message shows the answer without buttons', async () => {
    const { rest, handle, deps } = setup()
    await handleInteraction(component(customId({ action: 'gate', id: 'gat_1', n: 1 })), deps)
    expect(rest.interactionCallback.mock.calls[0][2].type).toBe(6)
    expect(handle.mock.calls).toEqual([['gate-resolve', { id: 'gat_1', resolution: 'Right' }]])
    const edited = rest.editOriginalInteraction.mock.calls[0][2]
    expect(edited.components).toEqual([])
    expect(JSON.stringify(edited)).toContain('Answered: Right')
  })

  it('a Gate select menu reads the option index from its value', async () => {
    const { handle, deps } = setup()
    await handleInteraction(component(customId({ action: 'gate', id: 'gat_1', n: 0 }), OWNER, ['0']), deps)
    expect(handle.mock.calls).toEqual([['gate-resolve', { id: 'gat_1', resolution: 'Left' }]])
  })

  it('Other answer opens a modal, and its submit resolves the Gate with the typed text', async () => {
    const { rest, handle, deps } = setup()
    await handleInteraction(component(customId({ action: 'gate-other', id: 'gat_1' })), deps)
    expect(rest.interactionCallback.mock.calls[0][2].type).toBe(9)
    expect(handle).not.toHaveBeenCalled()
    await handleInteraction(modal(customId({ action: 'gate-other', id: 'gat_1' }), '  Go up  '), deps)
    expect(handle.mock.calls).toEqual([['gate-resolve', { id: 'gat_1', resolution: 'Go up' }]])
  })

  it('a Gate already answered runs nothing', async () => {
    const s = baseState()
    s.gates = [{ ...gate, status: 'resolved', resolution: 'Left' }]
    const { handle, rest, deps } = setup({ state: s })
    await handleInteraction(component(customId({ action: 'gate', id: 'gat_1', n: 1 })), deps)
    expect(handle).not.toHaveBeenCalled()
    expect(JSON.stringify(rest.editOriginalInteraction.mock.calls[0][2])).toContain('Answered: Left')
  })

  it('Talk to the planner: a modal, then jobs-feedback, and says what happened', async () => {
    const { rest, handle, deps, changed } = setup({ handle: async () => ({ status: 200, body: { jobId: 'job_1', via: 'queued' } }) })
    await handleInteraction(component(customId({ action: 'feedback', id: 'job_1' })), deps)
    expect(rest.interactionCallback.mock.calls[0][2].type).toBe(9)
    await handleInteraction(modal(customId({ action: 'feedback', id: 'job_1' }), 'Add tests'), deps)
    expect(handle.mock.calls).toEqual([['jobs-feedback', { job: 'job_1', text: 'Add tests' }]])
    expect(String(rest.editOriginalInteraction.mock.calls[0][2].content)).toContain('Queued')
    expect(changed).toEqual(['job_1'])
  })

  it('/plan new: jobs-create in the channel’s project, then jobs-plan', async () => {
    const { handle, deps, rest } = setup({ handle: async (cmd) => ({ status: 200, body: cmd === 'jobs-create' ? { id: 'job_9', objective: 'Build it' } : { jobId: 'job_9' } }) })
    await handleInteraction(command('new', [{ name: 'objective', value: 'Build it' }]), deps)
    expect(handle.mock.calls).toEqual([
      ['jobs-create', { cwd: '/repo', objective: 'Build it' }],
      ['jobs-plan', { id: 'job_9' }]
    ])
    expect(String(rest.editOriginalInteraction.mock.calls[0][2].content)).toContain('Build it')
  })

  it('/plan new takes the project option by id or name', async () => {
    const { handle, deps } = setup({ handle: async (cmd) => ({ status: 200, body: cmd === 'jobs-create' ? { id: 'job_9' } : {} }) })
    await handleInteraction(command('new', [{ name: 'objective', value: 'X' }, { name: 'project', value: 'repo' }], OWNER, 'ch_home'), deps)
    expect(handle.mock.calls[0]).toEqual(['jobs-create', { cwd: '/repo', objective: 'X' }])
  })

  it('/plan new with no project runs nothing', async () => {
    const { handle, deps, rest } = setup()
    await handleInteraction(command('new', [{ name: 'objective', value: 'X' }], OWNER, 'ch_home'), deps)
    expect(handle).not.toHaveBeenCalled()
    expect(JSON.stringify(rest.interactionCallback.mock.calls[0][2])).toContain('Pick a project')
  })

  it('/plan new whose planner does not start removes the half-made Job, as the app does', async () => {
    const { handle, deps } = setup({
      handle: async (cmd) => (cmd === 'jobs-plan' ? { status: 400, body: { error: 'no account is logged in to plan on' } } : { status: 200, body: { id: 'job_9' } })
    })
    await handleInteraction(command('new', [{ name: 'objective', value: 'X' }]), deps)
    expect(handle.mock.calls.map((c) => c[0])).toEqual(['jobs-create', 'jobs-plan', 'run-delete'])
    expect(handle.mock.calls[2][1]).toEqual({ id: 'job_9' })
  })

  it('/plan status shows this channel’s card, or every open plan in #astera', async () => {
    const a = setup()
    await handleInteraction(command('status'), a.deps)
    expect(JSON.stringify(a.rest.interactionCallback.mock.calls[0][2])).toContain('Ship it')
    const b = setup()
    await handleInteraction(command('status', undefined, OWNER, 'ch_home'), b.deps)
    const text = JSON.stringify(b.rest.interactionCallback.mock.calls[0][2])
    expect(text).toContain('Ship it')
    expect(text).toContain('Running one')
  })
})

describe('handlePlanMessage', () => {
  const msg = (over: Record<string, unknown> = {}) => ({ id: 'm1', channel_id: 'ch_plan1', content: 'Please add tests', author: { id: OWNER }, type: 0, ...over })

  it('sends the owner’s message to the planner and says what happened', async () => {
    const { rest, handle, deps } = setup({ handle: async () => ({ status: 200, body: { jobId: 'job_1', runId: 'r', mode: 'completion' } }) })
    expect(await handlePlanMessage(msg(), deps)).toBe(true)
    expect(handle.mock.calls).toEqual([['jobs-feedback', { job: 'job_1', text: 'Please add tests' }]])
    expect(String(rest.postMessage.mock.calls[0][1].content)).toContain('reopened')
  })

  it('says the refusal', async () => {
    const { rest, deps } = setup({ handle: async () => ({ status: 409, body: { error: 'the planner waits on a question: answer it in its tab first' } }) })
    await handlePlanMessage(msg(), deps)
    expect(String(rest.postMessage.mock.calls[0][1].content)).toContain('the planner waits on a question')
  })

  it('leaves bots, system messages, empty text and other channels alone', async () => {
    for (const m of [msg({ author: { id: OWNER, bot: true } }), msg({ type: 6 }), msg({ content: '   ' }), msg({ channel_id: 'ch_thread' })]) {
      const { handle, rest, deps } = setup()
      await handlePlanMessage(m, deps)
      expect(handle).not.toHaveBeenCalled()
      expect(rest.postMessage).not.toHaveBeenCalled()
    }
    const { deps } = setup()
    expect(await handlePlanMessage(msg({ channel_id: 'ch_thread' }), deps)).toBe(false)
  })
})

describe('planWorkspace', () => {
  function ws(cards: Record<string, string> = {}) {
    const { rest, handle, deps } = setup()
    const saved: Array<Record<string, string>> = []
    const w = planWorkspace({ ...deps, homeChannel: () => 'ch_home', cards, saveCards: (c) => saved.push(c) })
    return { rest, handle, w, saved }
  }

  it('posts a card once, pins it, then edits that same message', async () => {
    const { rest, w, saved } = ws()
    await w.refreshCard('job_1')
    await w.refreshCard('job_1')
    expect(rest.postMessage).toHaveBeenCalledTimes(1)
    expect(rest.pinMessage).toHaveBeenCalledWith('ch_plan1', 'msg_1')
    expect(rest.editMessage).toHaveBeenCalledWith('ch_plan1', 'msg_1', expect.anything())
    expect(saved.at(-1)).toEqual({ job_1: 'msg_1' })
    expect(w.cards()).toEqual({ job_1: 'msg_1' })
  })

  it('two refreshes at once post one card', async () => {
    const { rest, w } = ws()
    await Promise.all([w.refreshCard('job_1'), w.refreshCard('job_1')])
    expect(rest.postMessage).toHaveBeenCalledTimes(1)
  })

  it('posts again when the kept card is gone', async () => {
    const { rest, w } = ws({ job_1: 'msg_old' })
    rest.editMessage.mockRejectedValueOnce(new DiscordApiError(404, 10008))
    await w.refreshCard('job_1')
    expect(rest.postMessage).toHaveBeenCalledTimes(1)
    expect(w.cards()).toEqual({ job_1: 'msg_1' })
  })

  it('a plan with no channel or gone posts nothing', async () => {
    const { rest, w } = ws()
    await w.refreshCard('job_none')
    expect(rest.postMessage).not.toHaveBeenCalled()
  })

  it('posts a Gate in its plan’s channel and a notice in #astera', async () => {
    const { rest, w } = ws()
    await w.postGate(gate)
    expect(rest.postMessage.mock.calls[0][0]).toBe('ch_plan2')
    await w.postNotice({ title: 'Plan done', body: 'All good' })
    expect(rest.postMessage.mock.calls[1]).toEqual(['ch_home', { content: '**Plan done**\nAll good' }])
  })

  it('onDispatch takes interactions and plan-channel messages, and registers the commands on READY', async () => {
    const { rest, handle, w } = ws()
    expect(w.onDispatch('READY', { application: { id: 'app_1' } })).toBe(false)
    await vi.waitFor(() => expect(rest.bulkOverwriteGuildCommands).toHaveBeenCalledWith('app_1', 'g1', expect.any(Array)))
    expect(w.onDispatch('INTERACTION_CREATE', command('status'))).toBe(true)
    expect(w.onDispatch('MESSAGE_CREATE', { id: 'm', channel_id: 'ch_plan1', content: 'hi', author: { id: OWNER }, type: 0 })).toBe(true)
    await vi.waitFor(() => expect(handle).toHaveBeenCalledWith('jobs-feedback', { job: 'job_1', text: 'hi' }))
    expect(w.onDispatch('MESSAGE_CREATE', { id: 'm', channel_id: 'ch_other', content: 'hi', author: { id: OWNER } })).toBe(false)
    expect(w.onDispatch('GUILD_CREATE', {})).toBe(false)
  })
})
