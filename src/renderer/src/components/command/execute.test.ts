import { describe, expect, it } from 'vitest'
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
  projects: [{ id: 'g', name: 'Gameful', path: '/p/g' }],
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
    plan({ jobId: 'j-sched', name: 'Nightly', scheduled: true, runId: 'r-sched' })
  ],
  currentProjectPath: '/p/g',
  currentPlanId: null
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
        return cmd === 'run-create' ? { status: 200, body: { id: 'j-new' } } : { status: 200, body: {} }
      }
    }) as unknown as OrchDoor
  const ui: ActionUi = {
    t: (k) => k,
    confirm: async (o) => {
      asked.push(o.title)
      return confirm
    },
    confirmChoices: async () => ({ ok: confirm, checked: [] }),
    error: () => {}
  }
  return {
    sent,
    asked,
    deps: {
      door,
      ui,
      tasks: [],
      nowMs: 0,
      attention: async () => 'idle',
      openPlan: () => {},
      openRun: () => {},
      snapshotFor: () => null,
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
    [{ kind: 'pause', target: 'Trading' }, 'runs-stop'],
    [{ kind: 'stop-launching', target: 'Nightly' }, 'run-pause']
  ])('%j sends nothing when the dialog is declined', async (intent) => {
    const h = harness(false)
    await execute(ready(intent), h.deps)
    expect(h.asked).toHaveLength(1)
    expect(h.sent).toEqual([])
  })

  it.each<[Intent, string, Record<string, unknown>]>([
    [{ kind: 'approve', target: 'Draft' }, 'run-start', { run: 'j-draft' }],
    [{ kind: 'pause', target: 'Trading' }, 'runs-stop', { id: 'r-run' }],
    [{ kind: 'stop-launching', target: 'Nightly' }, 'run-pause', { run: 'j-sched' }]
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
  it('plan = the "+ New job" call, then the planner on the new Job', async () => {
    const h = harness(true)
    await execute(ready({ kind: 'plan', objective: 'the next Gameful refactor' }), h.deps)
    expect(h.sent).toEqual([
      { path: '/p/g', cmd: 'run-create', args: { objective: 'the next Gameful refactor', cwd: '/p/g', coordinatorAccount: 'acc-1', auto: true } },
      { path: '/p/g', cmd: 'jobs-plan', args: { id: 'j-new' } }
    ])
    expect(h.asked).toEqual([])
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

  it('archive and delete act only with the Jobs view snapshot of that project', async () => {
    const h = harness(true)
    const lines = await execute(ready({ kind: 'delete', target: 'Trading' }), h.deps)
    expect(h.sent).toEqual([])
    expect(lines[0].text).toBe('command.refused.openProject')
  })
})
