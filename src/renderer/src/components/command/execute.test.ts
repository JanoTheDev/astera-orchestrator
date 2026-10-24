import { describe, expect, it } from 'vitest'
import type { OrchSnapshot } from '../../../../core/types'
import type { Directory, DirPlan } from '../../../../core/intents/resolve'
import type { Intent } from '../../../../core/intents/types'
import type { OrchDoor } from '../../lib/orchDoor'
import type { ActionUi } from '../../lib/jobActions'
import { execute, resolveIntent, type ExecDeps, type Ready } from './execute'

const plan = (o: Partial<DirPlan> & Pick<DirPlan, 'jobId' | 'name'>): DirPlan => ({
  projectId: 'g',
  projectName: 'Gameful',
  projectPath: '/p/g',
  scheduled: false,
  pendingStart: false,
  sessions: [],
  ...o
})

const DIR: Directory = {
  projects: [
    { id: 'g', name: 'Gameful', path: '/p/g' },
    { id: 'c', name: 'Console', path: '/p/c' }
  ],
  plans: [
    plan({ jobId: 'j-draft', name: 'Draft', pendingStart: true }),
    plan({
      jobId: 'j-run',
      name: 'Trading',
      runId: 'r-run',
      sessions: [
        { sessionId: 'sess-api-7f3', role: 'worker', label: 'Trading Worker 1', taskTitle: 'API endpoints' },
        { sessionId: 'sess-ui-9a1', role: 'worker', label: 'Trading Worker 2', taskTitle: 'UI' }
      ]
    }),
    plan({ jobId: 'j-sched', name: 'Nightly', scheduled: true, runId: 'r-sched' }),
    plan({ jobId: 'j-held', name: 'Held', runId: 'r-held', held: true }),
    // Another project's plan: not the one the Jobs view has open (#41)
    plan({ jobId: 'j-other', name: 'Legacy', projectId: 'c', projectName: 'Console', projectPath: '/p/c', runId: 'r-other' })
  ],
  currentProjectPath: '/p/g',
  currentPlanId: null
}

const SNAPSHOTS: Record<string, OrchSnapshot> = {
  '/p/c': {
    projectFolderBusy: false,
    runs: [{ id: 'j-other', objective: 'Legacy', outcome: 'running', done: 0, total: 2, eventCount: 3, sharesProjectFolder: false, tasks: [] } as never]
  }
}

function harness(confirm: boolean): { deps: ExecDeps; sent: Array<{ path: string; cmd: string; args: Record<string, unknown> }>; asked: string[] } {
  const sent: Array<{ path: string; cmd: string; args: Record<string, unknown> }> = []
  const asked: string[] = []
  const door = (path: string): OrchDoor =>
    ({
      projectKey: path,
      readOnlyReason: null,
      command: async (cmd: string, args: Record<string, unknown>) => {
        sent.push({ path, cmd, args })
        return cmd === 'jobs-create' ? { status: 200, body: { id: 'j-new' } } : { status: 200, body: {} }
      }
    }) as unknown as OrchDoor
  const ui: ActionUi = {
    t: (k) => k,
    confirm: async (o) => {
      asked.push(o.title)
      return confirm
    },
    confirmChoices: async (o) => {
      asked.push(o.title)
      return { ok: confirm, checked: [] }
    },
    error: () => {}
  }
  return {
    sent,
    asked,
    deps: {
      door,
      ui,
      tasks: [],
      dispatches: [
        { id: 'd-api', sessionId: 'sess-api-7f3' },
        { id: 'd-ui', sessionId: 'sess-ui-9a1', held: true }
      ],
      nowMs: 0,
      attention: async () => 'idle',
      openPlan: () => {},
      openRun: () => {},
      snapshotFor: async (path) => SNAPSHOTS[path] ?? null,
      coordinatorAccount: async () => 'acc-1'
    }
  }
}

const ready = (intent: Intent): Ready => {
  const r = resolveIntent(intent, DIR)
  if (!r.ok) throw new Error(`did not resolve: ${JSON.stringify(r.miss)}`)
  return r
}

describe('confirm-class intents run only through a confirmation', () => {
  it.each<[Intent, string]>([
    [{ kind: 'approve', target: 'Draft' }, 'run-start'],
    [{ kind: 'stop', target: 'Trading' }, 'runs-stop'],
    [{ kind: 'stop-launching', target: 'Nightly' }, 'run-pause'],
    [{ kind: 'pause', target: 'worker 1' }, 'worker-hold']
  ])('%j sends nothing when the dialog is declined', async (intent) => {
    const h = harness(false)
    await execute(ready(intent), h.deps)
    expect(h.asked).toHaveLength(1)
    expect(h.sent).toEqual([])
  })

  it.each<[Intent, string, Record<string, unknown>]>([
    [{ kind: 'approve', target: 'Draft' }, 'run-start', { run: 'j-draft' }],
    [{ kind: 'stop', target: 'Trading' }, 'runs-stop', { id: 'r-run' }],
    [{ kind: 'stop-launching', target: 'Nightly' }, 'run-pause', { run: 'j-sched' }],
    // #38: "pause worker 1" pauses that worker's open Dispatch, behind the confirmation
    [{ kind: 'pause', target: 'worker 1' }, 'worker-hold', { dispatch: 'd-api' }]
  ])('%j sends %s with the exact id once confirmed', async (intent, cmd, args) => {
    const h = harness(true)
    await execute(ready(intent), h.deps)
    expect(h.sent).toEqual([{ path: '/p/g', cmd, args }])
  })

  it('does not approve a plan that has started', async () => {
    const h = harness(true)
    await execute(ready({ kind: 'approve', target: 'Trading' }), h.deps)
    expect(h.asked).toEqual([])
    expect(h.sent).toEqual([])
  })
})

describe('intent → command', () => {
  it('plan = the Start page call (jobs-create, which names the plan short), then the planner on the new Job', async () => {
    const h = harness(true)
    const lines = await execute(ready({ kind: 'plan', objective: 'the next Gameful refactor' }), h.deps)
    expect(h.sent).toEqual([
      {
        path: '/p/g',
        cmd: 'jobs-create',
        args: { cwd: '/p/g', coordinatorAccount: 'acc-1', objective: 'the next Gameful refactor' }
      },
      { path: '/p/g', cmd: 'jobs-plan', args: { id: 'j-new' } }
    ])
    expect(lines).toEqual([{ text: 'command.done.planned', jobId: 'j-new' }])
    expect(h.asked).toEqual([])
  })

  it('plan whose planner fails deletes the made Job and its line carries no jobId', async () => {
    const h = harness(true)
    const door = h.deps.door
    h.deps.door = (path) => {
      const d = door(path)
      return { ...d, command: async (cmd, args) => (cmd === 'jobs-plan' ? { status: 409, body: { error: 'no room' } } : d.command(cmd, args)) }
    }
    const lines = await execute(ready({ kind: 'plan', objective: 'x' }), h.deps)
    expect(lines).toEqual([{ text: 'jobs.new.plannerFailed: no room' }])
    expect(h.sent.at(-1)).toEqual({ path: '/p/g', cmd: 'run-delete', args: { id: 'j-new' } })
  })

  it('plan that starts deletes nothing', async () => {
    const h = harness(true)
    await execute(ready({ kind: 'plan', objective: 'x' }), h.deps)
    expect(h.sent.map((s) => s.cmd)).not.toContain('run-delete')
  })

  it('plan on Auto sends no account (the Host picks the one with most room); none signed in is refused', async () => {
    const h = harness(true)
    h.deps.coordinatorAccount = async () => ''
    await execute(ready({ kind: 'plan', objective: 'x' }), h.deps)
    expect(h.sent[0].args).toEqual({ cwd: '/p/g', objective: 'x' })
    const none = harness(true)
    none.deps.coordinatorAccount = async () => null
    expect(await execute(ready({ kind: 'plan', objective: 'x' }), none.deps)).toEqual([{ text: 'command.noAccount' }])
    expect(none.sent).toEqual([])
  })

  it('resume of a stopped Run is runs-resume; of a schedule, run-resume', async () => {
    const h = harness(true)
    await execute(ready({ kind: 'resume', target: 'Trading' }), h.deps)
    await execute(ready({ kind: 'resume', target: 'Nightly' }), h.deps)
    expect(h.sent.map((s) => [s.cmd, s.args])).toEqual([
      ['runs-resume', { id: 'r-run' }],
      ['run-resume', { run: 'j-sched' }]
    ])
  })

  it('send goes to the exact session id the name resolved to', async () => {
    const h = harness(true)
    await execute(ready({ kind: 'send', session: 'the API worker', text: 'run the tests' }), h.deps)
    expect(h.sent).toEqual([{ path: '/p/g', cmd: 'sessions-send', args: { id: 'sess-api-7f3', text: 'run the tests' } }])
  })

  it('an ambiguous send resolves to nothing until a session is picked', () => {
    const r = resolveIntent({ kind: 'send', session: 'Trading worker', text: 'x' }, DIR)
    expect(r.ok).toBe(false)
    const picked = resolveIntent({ kind: 'send', session: 'Trading worker', text: 'x' }, DIR, { sessionId: 'sess-ui-9a1' })
    expect(picked).toMatchObject({ ok: true, session: { session: { sessionId: 'sess-ui-9a1' } } })
  })

  it('archive and delete read the counts of a plan of any project when asked (#41)', async () => {
    const h = harness(true)
    await execute(ready({ kind: 'archive', target: 'Legacy' }), h.deps)
    await execute(ready({ kind: 'delete', target: 'Legacy' }), h.deps)
    expect(h.sent.map((s) => [s.path, s.cmd, s.args])).toEqual([
      ['/p/c', 'jobs-archive', { id: 'j-other' }],
      ['/p/c', 'run-delete', { id: 'j-other' }]
    ])
    // Declined: nothing is sent
    const no = harness(false)
    await execute(ready({ kind: 'archive', target: 'Legacy' }), no.deps)
    expect(no.asked).toHaveLength(1)
    expect(no.sent).toEqual([])
  })

  it('archive of a plan whose snapshot cannot be read sends nothing', async () => {
    const h = harness(true)
    const lines = await execute(ready({ kind: 'delete', target: 'Trading' }), h.deps)
    expect(h.sent).toEqual([])
    expect(lines[0].text).toBe('command.refused.unreadable')
  })
})

describe('holds (#38, #39)', () => {
  it('pause and stop-launching of a plain plan hold its launching, asking nothing and closing nothing', async () => {
    for (const kind of ['pause', 'stop-launching'] as const) {
      const h = harness(false)
      await execute(ready({ kind, target: 'Trading' }), h.deps)
      expect(h.asked).toEqual([])
      expect(h.sent).toEqual([{ path: '/p/g', cmd: 'jobs-hold', args: { id: 'j-run' } }])
    }
  })

  it('resume lets a held plan launch again, and a paused worker take input again', async () => {
    const h = harness(true)
    await execute(ready({ kind: 'resume', target: 'Held' }), h.deps)
    await execute(ready({ kind: 'resume', target: 'Trading worker 2' }), h.deps)
    expect(h.sent.map((s) => [s.cmd, s.args])).toEqual([
      ['jobs-unhold', { id: 'j-held' }],
      ['worker-unhold', { dispatch: 'd-ui' }]
    ])
    expect(h.asked).toEqual([])
  })

  it('"pause worker 2" resolves to that worker, not to a question about plans', () => {
    expect(resolveIntent({ kind: 'pause', target: 'worker 2' }, DIR)).toMatchObject({
      ok: true,
      session: { session: { sessionId: 'sess-ui-9a1' } }
    })
    // A picked worker stays that worker, though the pin names its plan too
    const picked = resolveIntent({ kind: 'pause', target: 'worker' }, DIR, { sessionId: 'sess-api-7f3', planId: 'j-run' })
    expect(picked).toMatchObject({ ok: true, session: { session: { sessionId: 'sess-api-7f3' } } })
    // An ambiguous worker is a question about sessions
    expect(resolveIntent({ kind: 'pause', target: 'worker' }, DIR)).toMatchObject({ ok: false, miss: { what: 'session', why: 'ambiguous' } })
    // A plan name is still the plan
    expect(resolveIntent({ kind: 'pause', target: 'Trading' }, DIR)).toMatchObject({ ok: true, plan: { jobId: 'j-run' } })
    expect(resolveIntent({ kind: 'pause', target: 'Trading' }, DIR)).not.toHaveProperty('session')
  })
})
