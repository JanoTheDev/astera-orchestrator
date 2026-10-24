import { describe, it, expect } from 'vitest'
import { archiveJob, archiveJobs, deleteRun, pauseRun, renameJob, restartCoordinator, resumeRun, unarchiveJob, type ActionUi } from './jobActions'
import type { OrchDoor } from './orchDoor'
import type { OrchSnapshot } from '../../../core/types'

/** A door that records each command and answers from `reply`. */
const door = (reply: { status: number; body: unknown } = { status: 200, body: {} }) => {
  const sent: Array<[string, Record<string, unknown>]> = []
  const d: OrchDoor = {
    projectKey: '/repo',
    readOnlyReason: null,
    command: async (cmd, args) => (sent.push([cmd, args]), reply),
    accounts: async () => [],
    signedInIds: async () => new Set(),
    runConfigs: async () => [],
    checkPlugins: async () => []
  }
  return Object.assign(d, { sent })
}

/** A ui whose dialogs answer as told and that records what it was asked and what it showed. */
const ui = (o: { confirm?: boolean; checked?: string[] | null; hide?: boolean } = {}) => {
  const asked: Array<{ title: string; body: string; choices?: Array<{ id: string }> }> = []
  const errors: string[] = []
  const hidden: string[] = []
  const u: ActionUi = {
    t: (key, params) => `${key}${params ? ` ${JSON.stringify(params)}` : ''}`,
    confirm: async (q) => (asked.push(q), o.confirm ?? true),
    confirmChoices: async (q) => (asked.push(q), o.checked === null ? { ok: false, checked: [] } : { ok: true, checked: o.checked ?? [] }),
    error: (m) => void errors.push(m),
    ...(o.hide ? { hide: (ps: string[]) => void hidden.push(...ps) } : {})
  }
  return Object.assign(u, { asked, errors, hidden })
}

const snapshot = (): OrchSnapshot =>
  ({
    runs: [
      { id: 'r1', objective: 'ship it', total: 2, eventCount: 7, worktrees: ['/wt/a', '/wt/b'], tasks: [{ id: 't1', startedAt: 'x' }, { id: 't2' }] }
    ],
    projectFolderBusy: false
  }) as unknown as OrchSnapshot

describe('Job actions through a door (remote runtime design Phase 7)', () => {
  it('delete asks with the counts and the worktree choices, then sends merge and removal as chosen', async () => {
    const d = door()
    const u = ui({ checked: ['merge', 'worktrees'], hide: true })
    await deleteRun(d, snapshot(), 'r1', u)
    expect(u.asked[0].body).toContain('"objective":"ship it"')
    expect(u.asked[0].choices?.map((c) => c.id)).toEqual(['merge', 'hide', 'worktrees'])
    expect(d.sent).toEqual([['run-delete', { id: 'r1', merge: true, removeWorktrees: true }]])
  })
  // Plugin 4d review I1: a Job made from a ticket is asked about by the name its card shows, not by its whole objective
  it('delete names a Job made from a ticket by the ticket’s title', async () => {
    const u = ui({ checked: null })
    const s = snapshot()
    Object.assign(s.runs[0], {
      objective: 'Resolve Linear ENG-1 (https://linear.app/x/ENG-1).\n\nThe following is the item’s content',
      source: { id: 'astera-linear-source', itemId: 'ENG-1', label: 'Linear ENG-1', title: 'Fix login' }
    })
    await deleteRun(door(), s, 'r1', u)
    expect(u.asked[0].body).toContain('"objective":"Fix login"')
    expect(u.asked[0].body).not.toContain('Resolve')
  })

  it('hide hides the folders only after the delete went through', async () => {
    const u = ui({ checked: ['hide'], hide: true })
    await deleteRun(door(), snapshot(), 'r1', u)
    expect(u.hidden).toEqual(['/wt/a', '/wt/b'])
    const refused = ui({ checked: ['hide'], hide: true })
    await deleteRun(door({ status: 409, body: { error: 'running' } }), snapshot(), 'r1', refused)
    expect(refused.hidden).toEqual([])
  })
  it('a delete with no hide (a remote Job: the history list is this computer\'s) offers no "hide" choice', async () => {
    const u = ui({ checked: [] })
    await deleteRun(door(), snapshot(), 'r1', u)
    expect(u.asked[0].choices?.map((c) => c.id)).toEqual(['merge', 'worktrees'])
  })
  it('a declined delete sends nothing', async () => {
    const d = door()
    await deleteRun(d, snapshot(), 'r1', ui({ checked: null }))
    expect(d.sent).toEqual([])
  })
  it('a 409 for a retained worker says so; another 409 says stop first; worktrees kept are said', async () => {
    const retained = ui()
    await deleteRun(door({ status: 409, body: { error: 'worker-retain holds it' } }), snapshot(), 'r1', retained)
    expect(retained.errors).toEqual(['jobs.run.deleteRetained'])
    const busy = ui()
    await deleteRun(door({ status: 409, body: { error: 'running' } }), snapshot(), 'r1', busy)
    expect(busy.errors).toEqual(['jobs.run.deleteBusy'])
    const kept = ui()
    await deleteRun(door({ status: 200, body: { worktreesKept: ['/wt/a'] } }), snapshot(), 'r1', kept)
    expect(kept.errors).toEqual(['jobs.run.deleteKeptWorktrees {"count":1}'])
  })
  it('pause asks first and sends run-pause; resume sends run-resume; restart sends run-start', async () => {
    const d = door()
    const declined = ui({ confirm: false })
    await pauseRun(d, 'r1', declined)
    expect(d.sent).toEqual([])
    await pauseRun(d, 'r1', ui())
    await resumeRun(d, 'r1', ui())
    await restartCoordinator(d, 'r1', ui())
    expect(d.sent).toEqual([
      ['run-pause', { run: 'r1' }],
      ['run-resume', { run: 'r1' }],
      ['run-start', { run: 'r1' }]
    ])
  })
  it("a read-only door's refusal is shown with its reason, not as a generic failure", async () => {
    const d = door({ status: 403, body: { error: 'read only pairing', code: 'RUNTIME_PERMISSION_DENIED' } })
    const u = ui()
    await resumeRun(d, 'r1', u)
    await restartCoordinator(d, 'r1', u)
    expect(u.errors).toEqual(['read only pairing', 'read only pairing'])
  })
  it('a Runtime that cannot be asked is a failure, never a success', async () => {
    const u = ui()
    await resumeRun(door({ status: 503, body: { error: 'down', code: 'RUNTIME_OFFLINE' } }), 'r1', u)
    expect(u.errors).toEqual(['jobs.runtime.unreachable'])
  })

  // Phase 7 review I1: a lost answer is not "a worker is running, stop it first".
  it('a delete whose answer was lost says it may have gone through, not that a worker runs', async () => {
    const u = ui()
    await deleteRun(door({ status: 409, body: { error: 'lost', code: 'RUNTIME_OUTCOME_UNKNOWN' } }), snapshot(), 'r1', u)
    expect(u.errors).toEqual(['jobs.runtime.outcomeUnknown'])
    const p = ui()
    await pauseRun(door({ status: 409, body: { error: 'lost', code: 'RUNTIME_OUTCOME_UNKNOWN' } }), 'r1', p)
    expect(p.errors).toEqual(['jobs.runtime.outcomeUnknown'])
  })
  // Phase 7 review M6
  it('a resume that fails says it could not resume', async () => {
    const u = ui()
    await resumeRun(door({ status: 400, body: { error: 'no' } }), 'r1', u)
    expect(u.errors).toEqual(['jobs.run.resumeFailed'])
  })
})

// W1-C plan lifecycle: closing sessions on archive is only ever the person's own tick (SPEC §12, CONTEXT rule 6)
describe('plan lifecycle actions', () => {
  it('archive asks, offers closing the sessions unticked, and sends killSessions only when ticked', async () => {
    const left = door()
    const u = ui()
    await archiveJob(left, snapshot(), 'r1', u)
    expect(u.asked[0].choices?.map((c) => c.id)).toEqual(['kill'])
    expect(left.sent).toEqual([['jobs-archive', { id: 'r1' }]])
    const killed = door()
    await archiveJob(killed, snapshot(), 'r1', ui({ checked: ['kill'] }))
    expect(killed.sent).toEqual([['jobs-archive', { id: 'r1', killSessions: true }]])
    const declined = door()
    await archiveJob(declined, snapshot(), 'r1', ui({ checked: null }))
    expect(declined.sent).toEqual([])
  })

  it('rename and unarchive send their commands without asking, and a refusal is shown', async () => {
    const d = door()
    const u = ui()
    await renameJob(d, 'r1', 'Login', u)
    await unarchiveJob(d, 'r1', u)
    expect(d.sent).toEqual([['jobs-rename', { id: 'r1', title: 'Login' }], ['jobs-unarchive', { id: 'r1' }]])
    expect(u.asked).toEqual([])
    const refused = ui()
    await renameJob(door({ status: 404, body: { error: 'unknown job: r1' } }), 'r1', 'x', refused)
    expect(refused.errors).toHaveLength(1)
  })
})

describe('approvePlan: W8-F (#94) the refusal toast', () => {
  it('lists the problems and asks to be closed on its own', async () => {
    const { approvePlan, PLAN_INVALID_TOAST_MS } = await import('./jobActions')
    const calls: Array<{ m: string; o?: { ttlMs?: number } }> = []
    const u: ActionUi = { ...ui(), error: (m, o) => void calls.push({ m, o }) }
    const d = door({ status: 400, body: { error: 'x', problems: ['tsk_1 (P7) has no basis'] } })
    expect(await approvePlan(d, 'job_1', 'plan', u)).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0].m).toContain('tsk_1 (P7) has no basis')
    expect(calls[0].o).toEqual({ ttlMs: PLAN_INVALID_TOAST_MS })
  })
})

describe('archiveJobs', () => {
  it('sends one jobs-archive per Job, with killSessions only when asked, and counts the answers', async () => {
    const d = door()
    expect(await archiveJobs(d, ['a', 'b'], false)).toEqual({ archived: 2, failed: 0 })
    expect(await archiveJobs(d, ['c'], true)).toEqual({ archived: 1, failed: 0 })
    expect(d.sent).toEqual([['jobs-archive', { id: 'a' }], ['jobs-archive', { id: 'b' }], ['jobs-archive', { id: 'c', killSessions: true }]])
  })
  it('counts a refusal or a thrown send as failed and goes on to the next Job', async () => {
    const d = door({ status: 409, body: {} })
    expect(await archiveJobs(d, ['a', 'b'], false)).toEqual({ archived: 0, failed: 2 })
    const t = door()
    t.command = async (_c, args) => {
      if (args.id === 'a') throw new Error('ipc')
      return { status: 200, body: {} }
    }
    expect(await archiveJobs(t, ['a', 'b'], false)).toEqual({ archived: 1, failed: 1 })
  })
})
