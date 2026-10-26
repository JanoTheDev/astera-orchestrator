import { describe, expect, it } from 'vitest'
import { emptyState, type OrchState } from '../../orchestration/state'
import type { Dispatch, Gate, Job, JobRun, Project, Task } from '../../orchestration/types'
import { ChannelType, type DiscordChannel } from '../rest'
import {
  ARCHIVE_CAP,
  ARCHIVE_CATEGORY,
  ASTERA_CATEGORY,
  CONTROL_CHANNEL,
  GUILD_CHANNEL_CAP,
  SESSIONS_CHANNEL,
  desiredLayout,
  planChannelOfSession,
  reconcile,
  type DesiredLayout,
  type Op
} from './layout'
import { emptyWorkspaceStore, slotId, withSlot, type WorkspaceStore } from './store'

const G = 'g1'
const at = (n: number): string => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString()

function state(jobs: Array<Partial<Job> & { id: string }>, extra: Partial<OrchState> = {}): OrchState {
  const s = emptyState()
  s.projects = [{ id: 'p1', path: '/r/web', name: 'Web', addedAt: at(0) } as Project]
  s.jobs = jobs.map(
    (j, i) =>
      ({
        objective: `Plan ${j.id}`,
        cwd: '/r/web',
        projectId: 'p1',
        createdAt: at(i + 1),
        ...j
      }) as Job
  )
  return { ...s, ...extra }
}

let next = 9000
/** Runs the ops against an in-memory guild and store, the way apply.ts does against Discord. */
function simulate(
  ops: Op[],
  guild: DiscordChannel[],
  store: WorkspaceStore
): { guild: DiscordChannel[]; store: WorkspaceStore } {
  let g = guild.map((c) => ({ ...c }))
  let s = store
  const id = (slot: Parameters<typeof slotId>[1]): string => slotId(s, slot)!
  for (const op of ops) {
    if (op.op === 'createCategory' || op.op === 'createChannel') {
      const ch: DiscordChannel = {
        id: String(next++),
        type: op.op === 'createCategory' ? ChannelType.GUILD_CATEGORY : ChannelType.GUILD_TEXT,
        name: op.name,
        parent_id: op.op === 'createChannel' ? id(op.parent) : null,
        topic: op.op === 'createChannel' ? (op.topic ?? null) : null,
        position: 99
      }
      g.push(ch)
      s = withSlot(s, op.slot, ch.id, op.name)
    } else if (op.op === 'remember') s = withSlot(s, op.slot, op.id, op.name)
    else if (op.op === 'rename') {
      g.find((c) => c.id === op.id)!.name = op.name
      s = withSlot(s, op.slot, op.id, op.name)
    } else if (op.op === 'setTopic') g.find((c) => c.id === op.id)!.topic = op.topic
    else if (op.op === 'move') g.find((c) => c.id === op.id)!.parent_id = id(op.parent)
    else if (op.op === 'archive') g.find((c) => c.id === op.id)!.parent_id = id('cat:archive')
    else if (op.op === 'deleteArchived') {
      g = g.filter((c) => c.id !== op.id)
      s = withSlot(s, op.slot, null)
    } else if (op.op === 'setPositions') op.slots.forEach((slot, i) => (g.find((c) => c.id === id(slot))!.position = i))
  }
  return { guild: g, store: s }
}

const desired = (s: OrchState, plans = true): DesiredLayout => desiredLayout(s, { guildId: G, plans })
/** The guild and store after a first sync of `s` from an empty server. */
const synced = (s: OrchState) => simulate(reconcile(desired(s), [], emptyWorkspaceStore(G)), [], emptyWorkspaceStore(G))
const kinds = (ops: Op[]): string[] => ops.map((o) => o.op)
const foreign = (id: string, over: Partial<DiscordChannel> = {}): DiscordChannel => ({
  id,
  type: ChannelType.GUILD_TEXT,
  name: 'general',
  parent_id: null,
  ...over
})

describe('desiredLayout', () => {
  it('groups active plans by project, orders those needing the owner first, then running, then the rest', () => {
    const s = state([
      { id: 'job_idle', title: 'Idle one' },
      { id: 'job_run', title: 'Running one' },
      { id: 'job_gate', title: 'Gated one' },
      {
        id: 'job_appr',
        title: 'Approve me',
        pendingStart: true,
        plannerSessionIds: []
      },
      { id: 'job_old', title: 'Archived', archivedAt: at(50) }
    ])
    s.runs = [
      {
        id: 'run_1',
        jobId: 'job_run',
        ordinal: 1,
        createdAt: at(10)
      } as JobRun,
      {
        id: 'run_2',
        jobId: 'job_gate',
        ordinal: 1,
        createdAt: at(10)
      } as JobRun
    ]
    s.gates = [
      {
        id: 'gat_1',
        runId: 'run_2',
        taskId: 't',
        question: 'q',
        status: 'open',
        createdAt: at(11)
      } as Gate
    ]
    const d = desired(s)
    expect(d.projects).toHaveLength(1)
    expect(d.projects[0]).toMatchObject({ id: 'p1', name: 'Web' })
    expect(d.projects[0]!.plans.map((p) => p.jobId)).toEqual(['job_gate', 'job_appr', 'job_run', 'job_idle'])
    expect(d.projects[0]!.plans[1]).toEqual({
      jobId: 'job_appr',
      name: 'approve-me',
      topic: 'awaiting your approval · job_appr'
    })
    expect(d.projects[0]!.plans[2]!.topic).toBe('running · job_run')
  })

  it('has no projects with plans:false and none for a project whose plans are all archived', () => {
    expect(desired(state([{ id: 'job_a' }]), false)).toEqual({
      guildId: G,
      plans: false,
      projects: []
    })
    expect(desired(state([{ id: 'job_a', archivedAt: at(9) }])).projects).toEqual([])
  })

  it('cuts a project name to 100 characters', () => {
    const s = state([{ id: 'job_a' }])
    s.projects[0]!.name = 'x'.repeat(150)
    expect(desired(s).projects[0]!.name).toHaveLength(100)
  })
})

describe('desiredLayout names the real state', () => {
  it('ranks a held plan and a waiting planner question with the plans that need the owner, and names each state', () => {
    const s = state([
      { id: 'job_run', title: 'Running one' },
      { id: 'job_held', title: 'Held one', dispatchHold: true },
      { id: 'job_ask', title: 'Asked one', dispatchHold: true, lastReplan: { runId: 'run_3', mode: 'wave', wave: 1, done: 0, at: at(5), summary: 's', escalated: 'q' } },
      { id: 'job_final', title: 'Final one', replanning: { startedAt: at(6), runId: 'run_4', mode: 'completion', wave: 2, done: 0 } },
      { id: 'job_stop', title: 'Stopped one' },
      { id: 'job_merge', title: 'Merging one' }
    ])
    s.runs = [
      { id: 'run_1', jobId: 'job_run', ordinal: 1, createdAt: at(10) } as JobRun,
      { id: 'run_2', jobId: 'job_held', ordinal: 1, createdAt: at(10) } as JobRun,
      { id: 'run_3', jobId: 'job_ask', ordinal: 1, createdAt: at(10) } as JobRun,
      { id: 'run_4', jobId: 'job_final', ordinal: 1, createdAt: at(10) } as JobRun,
      { id: 'run_5', jobId: 'job_stop', ordinal: 1, createdAt: at(10), paused: true } as JobRun,
      { id: 'run_6', jobId: 'job_merge', ordinal: 1, createdAt: at(10), deliveryState: { state: 'delivering', attempts: 1 } } as JobRun
    ]
    const plans = desired(s).projects[0]!.plans
    const topic = Object.fromEntries(plans.map((p) => [p.jobId, p.topic]))
    expect(topic).toEqual({
      job_held: 'held by you: not launching new agents · job_held',
      job_ask: 'the planner asked you a question · job_ask',
      job_run: 'running · job_run',
      job_final: 'final check before merging · job_final',
      job_merge: 'merging into main · job_merge',
      job_stop: 'stopped · job_stop'
    })
    // rank 0 (needs the owner) first, then running and the re-plan, then the rest
    expect(plans.slice(0, 2).map((p) => p.jobId).sort()).toEqual(['job_ask', 'job_held'])
    expect(plans.at(-1)!.jobId).toBe('job_stop')
  })
})

describe('reconcile', () => {
  it('builds an empty server parents first, and a matching server yields []', () => {
    const s = state([{ id: 'job_a', title: 'Fix login' }])
    const ops = reconcile(desired(s), [], emptyWorkspaceStore(G))
    expect(kinds(ops)).toEqual([
      'createCategory',
      'createCategory',
      'createChannel',
      'createChannel',
      'createChannel',
      'setPositions'
    ])
    expect(ops[0]).toEqual({
      op: 'createCategory',
      slot: 'cat:astera',
      name: ASTERA_CATEGORY
    })
    expect(ops[1]).toEqual({
      op: 'createCategory',
      slot: 'cat:project:p1',
      name: 'Web'
    })
    expect(ops.slice(2, 4)).toEqual([
      {
        op: 'createChannel',
        slot: 'ch:control',
        name: CONTROL_CHANNEL,
        parent: 'cat:astera'
      },
      {
        op: 'createChannel',
        slot: 'ch:sessions',
        name: SESSIONS_CHANNEL,
        parent: 'cat:astera'
      }
    ])
    expect(ops[4]).toEqual({
      op: 'createChannel',
      slot: 'ch:plan:job_a',
      name: 'fix-login',
      parent: 'cat:project:p1',
      topic: 'not started · job_a'
    })
    const after = synced(s)
    expect(reconcile(desired(s), after.guild, after.store)).toEqual([])
  })

  const cases: Array<{ name: string; run: () => void }> = [
    {
      name: 'new plan: one channel in its project category, then positions',
      run: () => {
        const before = state([{ id: 'job_a' }])
        const { guild, store } = synced(before)
        const ops = reconcile(desired(state([{ id: 'job_a' }, { id: 'job_b', title: 'Second' }])), guild, store)
        expect(ops).toEqual([
          {
            op: 'createChannel',
            slot: 'ch:plan:job_b',
            name: 'second',
            parent: 'cat:project:p1',
            topic: 'not started · job_b'
          },
          { op: 'setPositions', slots: ['ch:plan:job_a', 'ch:plan:job_b'] }
        ])
      }
    },
    {
      name: 'new project: its category before its channel',
      run: () => {
        const s = state([{ id: 'job_a' }])
        const { guild, store } = synced(s)
        s.projects.push({
          id: 'p2',
          path: '/r/api',
          name: 'Api',
          addedAt: at(0)
        } as Project)
        s.jobs.push({
          id: 'job_b',
          objective: 'Api work',
          cwd: '/r/api',
          projectId: 'p2',
          createdAt: at(5)
        } as Job)
        expect(kinds(reconcile(desired(s), guild, store))).toEqual(['createCategory', 'createChannel', 'setPositions'])
      }
    },
    {
      name: 'plan renamed: the channel is renamed once',
      run: () => {
        const s = state([{ id: 'job_a', title: 'Old name' }])
        const { guild, store } = synced(s)
        s.jobs[0]!.title = 'New name'
        const ops = reconcile(desired(s), guild, store)
        expect(ops).toEqual([
          {
            op: 'rename',
            slot: 'ch:plan:job_a',
            id: slotId(store, 'ch:plan:job_a'),
            name: 'new-name'
          }
        ])
        const after = simulate(ops, guild, store)
        expect(reconcile(desired(s), after.guild, after.store)).toEqual([])
      }
    },
    {
      name: 'owner renamed a channel: kept until the plan name changes',
      run: () => {
        const s = state([{ id: 'job_a', title: 'Fix login' }])
        const { guild, store } = synced(s)
        const id = slotId(store, 'ch:plan:job_a')!
        guild.find((c) => c.id === id)!.name = 'my-name'
        guild.find((c) => c.id === slotId(store, 'ch:control'))!.name = 'control-room'
        expect(reconcile(desired(s), guild, store)).toEqual([])
        s.jobs[0]!.title = 'Fix signup'
        expect(reconcile(desired(s), guild, store)).toEqual([
          { op: 'rename', slot: 'ch:plan:job_a', id, name: 'fix-signup' }
        ])
      }
    },
    {
      name: 'plan archived: moved into a new archive category, read-only',
      run: () => {
        const s = state([{ id: 'job_a' }, { id: 'job_b' }])
        const { guild, store } = synced(s)
        s.jobs[0]!.archivedAt = at(30)
        const ops = reconcile(desired(s), guild, store)
        expect(ops).toEqual([
          { op: 'createCategory', slot: 'cat:archive', name: ARCHIVE_CATEGORY },
          {
            op: 'archive',
            slot: 'ch:plan:job_a',
            id: slotId(store, 'ch:plan:job_a')
          }
        ])
        const after = simulate(ops, guild, store)
        expect(reconcile(desired(s), after.guild, after.store)).toEqual([])
      }
    },
    {
      name: 'owner deleted a channel the store names: it is made again, once',
      run: () => {
        const s = state([{ id: 'job_a' }])
        const { guild, store } = synced(s)
        const left = guild.filter(
          (c) => c.id !== slotId(store, 'ch:plan:job_a') && c.id !== slotId(store, 'ch:sessions')
        )
        const ops = reconcile(desired(s), left, store)
        expect(kinds(ops)).toEqual(['createChannel', 'createChannel', 'setPositions'])
        const after = simulate(ops, left, store)
        expect(reconcile(desired(s), after.guild, after.store)).toEqual([])
      }
    },
    {
      name: '480 cap: no channel past it, and a capped marker',
      run: () => {
        const s = state([{ id: 'job_a' }])
        const { guild, store } = synced(state([]))
        const full = [...guild, ...Array.from({ length: GUILD_CHANNEL_CAP - guild.length }, (_, i) => foreign(`5${i}`))]
        expect(reconcile(desired(s), full, store)).toEqual([{ op: 'capped' }])
        // room for one: no category without room for its channel
        expect(reconcile(desired(s), full.slice(0, -1), store)).toEqual([{ op: 'capped' }])
        // room for two: the category and its channel; a second plan's channel waits
        s.jobs.push({
          id: 'job_b',
          objective: 'b',
          cwd: '/r/web',
          projectId: 'p1',
          createdAt: at(9)
        } as Job)
        expect(kinds(reconcile(desired(s), full.slice(0, -2), store))).toEqual([
          'createCategory',
          'createChannel',
          'setPositions',
          'capped'
        ])
      }
    },
    {
      name: 'archive cap: the oldest archived bot channel goes, never an owner channel',
      run: () => {
        const s = state([{ id: 'job_new' }])
        const { guild, store: st } = synced(s)
        let store = withSlot(st, 'cat:archive', '700', ARCHIVE_CATEGORY)
        const archived: DiscordChannel[] = []
        for (let i = 0; i < ARCHIVE_CAP - 1; i++) {
          archived.push(
            foreign(`8${String(i).padStart(2, '0')}`, {
              name: `old-${i}`,
              parent_id: '700'
            })
          )
          if (i < 3) store = withSlot(store, `ch:plan:job_old${i}`, `8${String(i).padStart(2, '0')}`, `old-${i}`)
        }
        archived.push(foreign('699', { name: 'owner-notes', parent_id: '700' })) // the owner's own, and the oldest
        const g = [
          ...guild,
          foreign('700', {
            type: ChannelType.GUILD_CATEGORY,
            name: ARCHIVE_CATEGORY
          }),
          ...archived
        ]
        s.jobs[0]!.archivedAt = at(40)
        const ops = reconcile(desired(s), g, store)
        expect(ops).toEqual([
          { op: 'deleteArchived', slot: 'ch:plan:job_old0', id: '800' },
          {
            op: 'archive',
            slot: 'ch:plan:job_new',
            id: slotId(store, 'ch:plan:job_new')
          }
        ])
      }
    },
    {
      name: 'plans:false: only the Astera category, plan channels left alone',
      run: () => {
        const s = state([{ id: 'job_a' }])
        expect(kinds(reconcile(desired(s, false), [], emptyWorkspaceStore(G)))).toEqual([
          'createCategory',
          'createChannel',
          'createChannel'
        ])
        const { guild, store } = synced(s)
        s.jobs[0]!.archivedAt = at(9)
        expect(reconcile(desired(s, false), guild, store)).toEqual([])
      }
    },
    {
      name: 'store from another guild: counts as empty, so nothing of the old guild is touched',
      run: () => {
        const s = state([{ id: 'job_a' }])
        const { store } = synced(s)
        const ops = reconcile(desired(s), [foreign('1')], {
          ...store,
          guildId: 'other'
        })
        expect(ops).toEqual(reconcile(desired(s), [foreign('1')], emptyWorkspaceStore(G)))
        expect(kinds(ops).filter((k) => k.startsWith('create'))).toHaveLength(5)
      }
    },
    {
      name: 'channels the bot did not create are never edited, moved or deleted',
      run: () => {
        const s = state([{ id: 'job_a', title: 'Fix login' }])
        const { guild, store } = synced(s)
        const catId = slotId(store, 'cat:project:p1')!
        const mine = [
          foreign('11', { name: 'fix-login', parent_id: catId, topic: 'mine' }),
          foreign('12', {
            name: 'astera',
            parent_id: slotId(store, 'cat:astera'),
            position: 0
          }),
          foreign('13', { type: ChannelType.GUILD_CATEGORY, name: 'Web' })
        ]
        const ops = reconcile(desired(s), [...guild, ...mine], store)
        expect(ops).toEqual([])
        s.jobs[0]!.archivedAt = at(9)
        const later = reconcile(desired(s), [...guild, ...mine], store)
        const touched = later.flatMap((o) => ('id' in o && o.id !== null ? [o.id] : []))
        expect(touched.some((id) => ['11', '12', '13'].includes(id))).toBe(false)
      }
    },
    {
      name: 'a lost store finds a plan channel by the Job id in its topic',
      run: () => {
        const s = state([{ id: 'job_a' }])
        const { guild, store } = synced(s)
        const id = slotId(store, 'ch:plan:job_a')!
        const lost = withSlot(store, 'ch:plan:job_a', null)
        const ops = reconcile(desired(s), guild, lost)
        expect(ops).toEqual([{ op: 'remember', slot: 'ch:plan:job_a', id, name: 'plan-job-a' }])
      }
    },
    {
      name: 'an Astera category and #sessions the session connection made first are taken over, not made twice',
      run: () => {
        const g = [
          foreign('40', { type: ChannelType.GUILD_CATEGORY, name: ASTERA_CATEGORY }),
          foreign('41', { name: SESSIONS_CHANNEL, parent_id: '40' }),
          foreign('42', { name: SESSIONS_CHANNEL, parent_id: null }) // the owner's own, outside Astera
        ]
        const ops = reconcile(desired(state([]), false), g, emptyWorkspaceStore(G))
        expect(ops).toEqual([
          { op: 'remember', slot: 'cat:astera', id: '40', name: ASTERA_CATEGORY },
          { op: 'remember', slot: 'ch:sessions', id: '41', name: SESSIONS_CHANNEL },
          { op: 'createChannel', slot: 'ch:control', name: CONTROL_CHANNEL, parent: 'cat:astera' }
        ])
        const after = simulate(ops, g, emptyWorkspaceStore(G))
        expect(reconcile(desired(state([]), false), after.guild, after.store)).toEqual([])
      }
    },
    {
      name: 'state change: the topic follows, and the order is set again',
      run: () => {
        const s = state([{ id: 'job_a' }, { id: 'job_b' }])
        const { guild, store } = synced(s)
        Object.assign(s.jobs[1]!, {
          pendingStart: true,
          plannerSessionIds: ['ses_1']
        })
        const ops = reconcile(desired(s), guild, store)
        expect(ops).toEqual([
          {
            op: 'setTopic',
            id: slotId(store, 'ch:plan:job_b'),
            topic: 'awaiting your approval · job_b'
          },
          { op: 'setPositions', slots: ['ch:plan:job_b', 'ch:plan:job_a'] }
        ])
      }
    }
  ]
  for (const c of cases) it(c.name, c.run)
})

describe('planChannelOfSession', () => {
  it("answers the channel of the plan whose Task's Dispatch ran in the session", () => {
    const s = state([{ id: 'job_a' }])
    s.runs = [{ id: 'run_1', jobId: 'job_a', ordinal: 1, createdAt: at(2) } as JobRun]
    s.tasks = [{ id: 'tsk_1', runId: 'run_1' } as Task]
    s.dispatches = [{ id: 'dsp_1', taskId: 'tsk_1', sessionId: 'ses_w' } as Dispatch]
    const store = withSlot(emptyWorkspaceStore(G), 'ch:plan:job_a', '77', 'plan-job-a')
    expect(planChannelOfSession(s, 'ses_w', store)).toBe('77')
    expect(planChannelOfSession(s, 'ses_other', store)).toBeNull()
    expect(planChannelOfSession(s, 'ses_w', emptyWorkspaceStore(G))).toBeNull()
  })
})
