import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emptyState, type OrchState } from '../core/orchestration/state'
import type { Dispatch, Gate, Job, JobRun, Task } from '../core/orchestration/types'
import type { ActivityDraft } from '../core/orchestration/activity'
import type { DiscordConfig } from '../core/discord/config'
import type { ChannelCreate, DiscordChannel, DiscordRest, MessageBody } from '../core/discord/rest'
import { ARCHIVE_CATEGORY } from '../core/discord/workspace/layout'
import { createDiscordWorkspace, WORKSPACE_FILE, type DiscordWorkspaceDeps } from './discordWorkspace'

const OWNER = '777'
const CFG: DiscordConfig = { botToken: 'MTIz.fake', guildId: '100', userId: OWNER, plans: true }

/** A Discord server in memory behind the REST calls the workspace makes; every call is recorded. */
function fakeRest() {
  const channels = new Map<string, DiscordChannel>()
  const posts: Array<{ channel: string; body: MessageBody; id: string }> = []
  const calls: string[] = []
  let next = 500
  const rest = {
    application: vi.fn(async () => ({ id: 'app', name: 'Astera' })),
    guildChannels: vi.fn(async () => [...channels.values()].map((c) => ({ ...c }))),
    createChannel: vi.fn(async (_g: string, ch: ChannelCreate) => {
      const made = { id: String(next++), ...ch }
      channels.set(made.id, made)
      return made
    }),
    editChannel: vi.fn(async (id: string, patch: Partial<ChannelCreate>) => {
      const ch = { ...channels.get(id)!, ...patch }
      channels.set(id, ch)
      return ch
    }),
    deleteChannel: vi.fn(async (id: string) => {
      const ch = channels.get(id)!
      channels.delete(id)
      return ch
    }),
    request: vi.fn(async () => undefined),
    postMessage: vi.fn(async (channel: string, body: MessageBody) => {
      const id = String(next++)
      posts.push({ channel, body, id })
      return { id, channel_id: channel, content: body.content ?? '' }
    }),
    editMessage: vi.fn(async (channel: string, id: string, body: MessageBody) => ({ id, channel_id: channel, content: body.content ?? '' })),
    pinMessage: vi.fn(async (channel: string, id: string) => void calls.push(`pin ${channel} ${id}`)),
    interactionCallback: vi.fn(async () => undefined),
    editOriginalInteraction: vi.fn(async () => ({ id: 'orig', channel_id: 'x', content: '' })),
    bulkOverwriteGuildCommands: vi.fn(async () => [])
  }
  const named = (name: string) => [...channels.values()].find((c) => c.name === name)
  return { rest: rest as unknown as DiscordRest, raw: rest, channels, posts, calls, named }
}

/** The activity log's read/tail/next over an array the test appends to. */
function fakeActivity() {
  const events: Array<ActivityDraft & { id: string; sequence: number; occurredAt: string }> = []
  const waiting = new Set<() => void>()
  const log = {
    tail: () => `e${events.length}`,
    read: (q: { after?: string }) => ({ events: events.slice(Number((q.after ?? 'e0').slice(1))), cursor: `e${events.length}`, gap: false }),
    next: () => new Promise<void>((r) => waiting.add(r))
  }
  const push = (d: ActivityDraft): void => {
    events.push({ ...d, id: `e${events.length + 1}`, sequence: events.length + 1, occurredAt: 'x' })
    for (const w of waiting) w()
    waiting.clear()
  }
  return { log: log as unknown as DiscordWorkspaceDeps['activity'], push }
}

const job = (over: Partial<Job> = {}): Job => ({ id: 'job_1', title: 'Fix login', objective: 'Fix the login', cwd: '/repo', projectId: 'prj_1', createdAt: '2026-10-01', ...over })
const gate: Gate = { id: 'gat_1', runId: 'run_1', taskId: 'tsk_1', question: 'Which way?', options: ['Left', 'Right'], status: 'open', createdAt: 'x' }

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup(o: { state?: OrchState } = {}) {
  const profileDir = mkdtempSync(path.join(os.tmpdir(), 'astera-discord-ws-'))
  dirs.push(profileDir)
  const dc = fakeRest()
  const activity = fakeActivity()
  const box = { state: o.state ?? { ...emptyState(), projects: [{ id: 'prj_1', path: '/repo', name: 'Repo', addedAt: 'x' }] } }
  const handle = vi.fn(async (_cmd: string, _args: Record<string, unknown>) => ({ status: 200, body: {} }))
  const logs: string[] = []
  const ws = createDiscordWorkspace({
    profileDir,
    rest: () => dc.rest,
    activity: activity.log,
    state: () => box.state,
    handle,
    lang: () => 'en',
    log: (m) => logs.push(m),
    debounceMs: 0
  })
  const press = (customId: string, userId: string) =>
    ws.onDispatch('INTERACTION_CREATE', { id: 'int', token: 'tok', application_id: 'app', channel_id: 'x', type: 3, member: { user: { id: userId } }, data: { custom_id: customId } })
  return { ws, dc, activity, box, handle, logs, profileDir, press }
}

describe('createDiscordWorkspace: the plan workspace end to end over a fake Discord', () => {
  it('lays out a new plan, posts Gate buttons, takes the owner press only, and archives a finished plan', async () => {
    const h = setup()
    await h.ws.apply(CFG)
    expect(h.ws.running()).toBe(true)
    // the start: the fixed layout, and /plan registered once with the application's id
    await vi.waitFor(() => expect(h.dc.named('astera')).toBeDefined())
    expect(h.dc.raw.bulkOverwriteGuildCommands).toHaveBeenCalledTimes(1)
    expect(h.dc.raw.bulkOverwriteGuildCommands.mock.calls[0]).toEqual(['app', '100', expect.any(Array)])
    // READY (every Gateway reconnect) registers nothing more
    expect(h.ws.onDispatch('READY', { application: { id: 'app' } })).toBe(false)

    // a new plan: its project's category, its channel there, and its card posted and pinned
    h.box.state = { ...h.box.state, jobs: [job({ plannerSessionIds: ['planner'] })] }
    h.activity.push({ type: 'plan.awaiting-approval', jobId: 'job_1', payload: { title: 'Fix login' } })
    await vi.waitFor(() => expect(h.dc.named('fix-login')).toBeDefined())
    const category = h.dc.named('Repo')!
    const channel = h.dc.named('fix-login')!
    expect(channel.parent_id).toBe(category.id)
    await vi.waitFor(() => expect(h.dc.posts.find((p) => p.channel === channel.id)).toBeDefined())
    const card = h.dc.posts.find((p) => p.channel === channel.id)!
    expect(card.body.embeds).toHaveLength(1)
    await vi.waitFor(() => expect(h.dc.calls).toContain(`pin ${channel.id} ${card.id}`))
    // the card's id is kept beside the layout, in the one file
    await vi.waitFor(() => expect(JSON.parse(readFileSync(path.join(h.profileDir, WORKSPACE_FILE), 'utf8')).cards).toEqual({ job_1: card.id }))

    // a Gate opens: its question with one button per option, in the plan's channel
    h.box.state = { ...h.box.state, runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: 'x' } as JobRun], gates: [gate] }
    h.activity.push({ type: 'gate.opened', jobId: 'job_1', runId: 'run_1', payload: { title: 'Which way?', gateId: 'gat_1' } })
    await vi.waitFor(() => expect(h.dc.posts.filter((p) => p.channel === channel.id)).toHaveLength(2))
    const ids = JSON.stringify(h.dc.posts.at(-1)!.body.components)
    expect(ids).toContain('astera:gate:gat_1:0')
    expect(ids).toContain('astera:gate:gat_1:1')
    // the card was edited in place, not posted again
    expect(h.dc.raw.editMessage).toHaveBeenCalledWith(channel.id, card.id, expect.anything())

    // a stranger's press runs nothing; the owner's resolves the Gate
    expect(h.press('astera:gate:gat_1:1', '999')).toBe(true)
    await vi.waitFor(() => expect(h.dc.raw.interactionCallback).toHaveBeenCalledTimes(1))
    expect(h.handle).not.toHaveBeenCalled()
    expect(h.press('astera:gate:gat_1:1', OWNER)).toBe(true)
    await vi.waitFor(() => expect(h.handle).toHaveBeenCalledWith('gate-resolve', { id: 'gat_1', resolution: 'Right' }))
    expect(h.handle).toHaveBeenCalledTimes(1)

    // the plan is archived: its channel moves to Astera archive
    h.box.state = { ...h.box.state, jobs: [job({ archivedAt: '2026-10-02' })] }
    h.activity.push({ type: 'plan.done', jobId: 'job_1', payload: { title: 'Fix login' } })
    await vi.waitFor(() => expect(h.dc.channels.get(channel.id)!.parent_id).toBe(h.dc.named(ARCHIVE_CATEGORY)?.id))
    await h.ws.stop()
  })

  it("gives a worker session's root its plan's channel, and any other session none", async () => {
    const state: OrchState = {
      ...emptyState(),
      projects: [{ id: 'prj_1', path: '/repo', name: 'Repo', addedAt: 'x' }],
      jobs: [job()],
      runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: 'x' } as JobRun],
      tasks: [{ id: 'tsk_1', runId: 'run_1', title: 'Do it', status: 'running' } as unknown as Task],
      dispatches: [{ id: 'dsp_1', taskId: 'tsk_1', sessionId: 'worker' } as Dispatch]
    }
    const h = setup({ state })
    await h.ws.apply(CFG)
    await vi.waitFor(() => expect(h.dc.named('fix-login')).toBeDefined())
    await vi.waitFor(async () => expect(await h.ws.rootChannel('worker')).toBe(h.dc.named('fix-login')!.id))
    expect(await h.ws.rootChannel('someone-else')).toBeNull()
    await h.ws.stop()
    expect(await h.ws.rootChannel('worker')).toBeNull()
  })

  it('does nothing with plans off, without a token or guild, or once stopped', async () => {
    for (const cfg of [{ ...CFG, plans: false }, { ...CFG, botToken: null }, { ...CFG, guildId: null }]) {
      const h = setup({ state: { ...emptyState(), jobs: [job()] } })
      await h.ws.apply(cfg)
      expect(h.ws.running()).toBe(false)
      h.activity.push({ type: 'plan.awaiting-approval', jobId: 'job_1', payload: { title: 'Fix login' } })
      expect(h.ws.onDispatch('INTERACTION_CREATE', {})).toBe(false)
      expect(h.ws.postNotice({ title: 't', body: 'b' })).toBe(false)
      await new Promise((r) => setTimeout(r, 10))
      for (const fn of Object.values(h.dc.raw)) expect(fn).not.toHaveBeenCalled()
    }
    // a running workspace turned off by a settings change stops following
    const h = setup()
    await h.ws.apply(CFG)
    await vi.waitFor(() => expect(h.dc.named('astera')).toBeDefined())
    await h.ws.apply({ ...CFG, plans: false })
    expect(h.ws.running()).toBe(false)
    const before = h.dc.raw.guildChannels.mock.calls.length
    h.box.state = { ...h.box.state, jobs: [job()] }
    h.activity.push({ type: 'plan.awaiting-approval', jobId: 'job_1', payload: { title: 'Fix login' } })
    await new Promise((r) => setTimeout(r, 10))
    expect(h.dc.raw.guildChannels.mock.calls.length).toBe(before)
  })

  it('posts a notice to #astera once it exists', async () => {
    const h = setup()
    await h.ws.apply(CFG)
    await vi.waitFor(() => expect(h.ws.postNotice({ title: 'Plan done', body: 'all green' })).toBe(true))
    const home = h.dc.named('astera')!
    await vi.waitFor(() => expect(h.dc.posts.filter((p) => p.channel === home.id)).toHaveLength(1))
    expect(h.dc.posts.find((p) => p.channel === home.id)!.body.content).toContain('Plan done')
    await h.ws.stop()
  })
})
