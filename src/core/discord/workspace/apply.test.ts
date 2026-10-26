import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyState, type OrchState } from '../../orchestration/state'
import type { Job, Project } from '../../orchestration/types'
import { ChannelType, DiscordApiError, type ChannelCreate, type DiscordChannel } from '../rest'
import { applyLayout, syncLayout, type LayoutRest } from './apply'
import { readWorkspaceStore, slotId, withSlot, emptyWorkspaceStore } from './store'

const G = '100000000000000001'

/** An in-memory Discord guild behind the calls the layout uses. `fail` answers the next matching call with an error. */
function fakeGuild(initial: DiscordChannel[] = []) {
  const channels = initial.map((c) => ({ ...c }))
  const calls: string[] = []
  const overwrites = new Map<string, unknown>()
  const fail: Array<{ match: string; error: DiscordApiError }> = []
  let next = 200000000000000000n
  const check = (call: string): void => {
    calls.push(call)
    const i = fail.findIndex((f) => call.startsWith(f.match))
    if (i >= 0) throw fail.splice(i, 1)[0]!.error
  }
  const find = (id: string): DiscordChannel => {
    const ch = channels.find((c) => c.id === id)
    if (!ch) throw new DiscordApiError(404, 10003)
    return ch
  }
  const rest: LayoutRest = {
    guildChannels: async () => {
      check('GET channels')
      return channels.map((c) => ({ ...c }))
    },
    createChannel: async (_g: string, ch: ChannelCreate) => {
      check(`POST ${ch.name}`)
      const made = {
        id: String(next++),
        type: ch.type,
        name: ch.name,
        parent_id: ch.parent_id ?? null,
        topic: ch.topic ?? null,
        position: 50
      }
      channels.push(made)
      return made
    },
    editChannel: async (id: string, patch: Partial<ChannelCreate>) => {
      check(`PATCH ${id} ${Object.keys(patch).join(',')}`)
      return Object.assign(find(id), patch)
    },
    deleteChannel: async (id: string) => {
      check(`DELETE ${id}`)
      const ch = find(id)
      channels.splice(channels.indexOf(ch), 1)
      return ch
    },
    request: (async (method: string, route: string, body?: unknown) => {
      check(`${method} ${route}`)
      if (route.endsWith('/channels') && method === 'PATCH')
        for (const p of body as Array<{ id: string; position: number }>) find(p.id).position = p.position
      else if (route.includes('/permissions/')) {
        const id = route.split('/')[2]!
        if (method === 'PUT') overwrites.set(id, body)
        else overwrites.delete(id)
      }
      return undefined
    }) as LayoutRest['request']
  }
  return { rest, channels, calls, overwrites, fail }
}

function state(jobs: Array<Partial<Job> & { id: string }>): OrchState {
  const s = emptyState()
  s.projects = [
    {
      id: 'p1',
      path: '/r/web',
      name: 'Web',
      addedAt: '2026-10-01T00:00:00.000Z'
    } as Project
  ]
  s.jobs = jobs.map(
    (j, i) =>
      ({
        objective: `Plan ${j.id}`,
        cwd: '/r/web',
        projectId: 'p1',
        createdAt: `2026-10-0${i + 1}T00:00:00.000Z`,
        ...j
      }) as Job
  )
  return s
}

let dir: string
let storePath: string
const lines: string[] = []
const log = (l: string): void => void lines.push(l)
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'discord-apply-'))
  storePath = join(dir, 'discord-workspace.json')
  lines.length = 0
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const sync = (s: OrchState, rest: LayoutRest, plans = true) =>
  syncLayout({ state: s, cfg: { guildId: G, plans }, rest, storePath, log })

describe('syncLayout', () => {
  it('builds the layout, saves the ids, and a second sync changes nothing', async () => {
    const g = fakeGuild([
      {
        id: '1',
        type: ChannelType.GUILD_TEXT,
        name: 'general',
        parent_id: null
      }
    ])
    const s = state([
      { id: 'job_a', title: 'Fix login' },
      { id: 'job_b', title: 'Add search' }
    ])
    const store = await sync(s, g.rest)
    expect(store).not.toBeNull()
    expect(await readWorkspaceStore(storePath, G)).toEqual(store)
    const plan = g.channels.find((c) => c.id === slotId(store!, 'ch:plan:job_a'))!
    expect(plan).toMatchObject({
      name: 'fix-login',
      parent_id: slotId(store!, 'cat:project:p1'),
      topic: 'not started · job_a'
    })
    expect(g.channels.find((c) => c.id === store!.channels.sessions)).toMatchObject({
      name: 'sessions',
      parent_id: store!.categories.astera
    })
    g.calls.length = 0
    expect(await sync(s, g.rest)).toEqual(store)
    expect(g.calls).toEqual(['GET channels'])
    expect(lines).toEqual([])
  })

  it('archives a plan read-only into the archive category and never touches the owner channel', async () => {
    const g = fakeGuild([
      {
        id: '1',
        type: ChannelType.GUILD_TEXT,
        name: 'general',
        parent_id: null
      }
    ])
    const s = state([{ id: 'job_a' }])
    const before = (await sync(s, g.rest))!
    s.jobs[0]!.archivedAt = '2026-10-20T00:00:00.000Z'
    const after = (await sync(s, g.rest))!
    const id = slotId(after, 'ch:plan:job_a')!
    expect(g.channels.find((c) => c.id === id)!.parent_id).toBe(after.categories.archive)
    expect(g.overwrites.get(id)).toEqual({ type: 0, allow: '0', deny: '2048' })
    expect(id).toBe(slotId(before, 'ch:plan:job_a'))
    expect(g.calls.some((c) => / 1( |$)/.test(c))).toBe(false)
  })

  it('stops at a missing permission with one line naming it', async () => {
    const g = fakeGuild()
    g.fail.push({ match: 'POST', error: new DiscordApiError(403, 50013) })
    const store = await sync(state([{ id: 'job_a' }]), g.rest)
    expect(store).toEqual(emptyWorkspaceStore(G))
    expect(g.calls).toEqual(['GET channels', 'POST Astera'])
    expect(lines).toEqual([
      'discord layout: the bot lacks the Manage Channels permission (status=403 code=50013); layout sync stopped'
    ])
  })

  it('skips a step whose channel is gone and carries on', async () => {
    const g = fakeGuild()
    const s = state([{ id: 'job_a' }])
    const first = (await sync(s, g.rest))!
    s.jobs[0]!.title = 'Renamed'
    g.fail.push({ match: 'PATCH', error: new DiscordApiError(404, 10003) })
    s.jobs.push({
      id: 'job_b',
      objective: 'b',
      cwd: '/r/web',
      projectId: 'p1',
      createdAt: '2026-10-09T00:00:00.000Z'
    } as Job)
    const store = (await sync(s, g.rest))!
    expect(slotId(store, 'ch:plan:job_b')).not.toBeNull()
    expect(store.names[slotId(first, 'ch:plan:job_a')!]).toBe('plan-job-a') // the failed rename is not recorded
    expect(lines).toEqual([])
  })

  it('logs and answers the store when the channel list fails, never rejecting', async () => {
    const g = fakeGuild()
    g.fail.push({ match: 'GET', error: new DiscordApiError(0, null) })
    expect(await sync(state([]), g.rest)).toEqual(emptyWorkspaceStore(G))
    expect(lines).toEqual(["discord layout: could not list the server's channels (status=0)"])
  })

  it('does nothing without a guild id', async () => {
    const g = fakeGuild()
    expect(
      await syncLayout({
        state: state([]),
        cfg: { guildId: null, plans: true },
        rest: g.rest,
        storePath,
        log
      })
    ).toBeNull()
    expect(g.calls).toEqual([])
  })
})

describe('applyLayout', () => {
  it('logs the channel cap once per guild', async () => {
    const g = fakeGuild()
    const store = emptyWorkspaceStore('cap-guild')
    await applyLayout([{ op: 'capped' }], store, { rest: g.rest, log })
    await applyLayout([{ op: 'capped' }], store, { rest: g.rest, log })
    expect(lines).toHaveLength(1)
  })

  it('names Manage Roles when locking an archived channel is refused', async () => {
    const g = fakeGuild([{ id: '5', type: ChannelType.GUILD_TEXT, name: 'x', parent_id: null }])
    g.fail.push({ match: 'PUT', error: new DiscordApiError(403, 50013) })
    const store = withSlot(
      withSlot(emptyWorkspaceStore(G), 'cat:archive', '9', 'Astera archive'),
      'ch:plan:job_a',
      '5',
      'x'
    )
    await applyLayout([{ op: 'archive', slot: 'ch:plan:job_a', id: '5' }], store, { rest: g.rest, log })
    expect(lines[0]).toContain('Manage Roles')
    expect(g.channels[0]!.parent_id).toBeNull()
  })
})
