// W8-C prompts mode ("Run as written"): `jobs-create --mode prompts` writes one Task per prompt, unchanged, and the
// planner and the approval keep it that way.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { renderPlanMd, validatePlan } from './planner'
import { sha256Of } from './promptWaves'

const NOW = '2026-10-18T00:00:00.000Z'
const PLANNER = 'ses-planner'
const PLAN_MD = [
  '| Wave | Tabs | Prompts | Depends on |',
  '|---|---|---|---|',
  '| 9.0 (done) | 1 | `W9-0-design-spec` | W8 merged |',
  '| 9.1 | 1 | `W9-A-foundation` (alone) | 9.0 approved |',
  '| 9.2 | 2 | `W9-B-shell`, `W9-C-plan-tab` | 9.1 merged |'
].join('\n')

const rig = (files: Record<string, string>) => {
  let state: OrchState = emptyState()
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    startWorker: async () => ({ sessionId: 'ses-worker', cwd: '/p', specPath: '/s.md' }),
    startCoordinator: async (a: Record<string, unknown>) => ({ sessionId: a.role === 'planner' ? PLANNER : 'ses-coordinator' }),
    stopCoordinator: async () => {},
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    readWorker: async () => '',
    now: () => NOW,
    intakeInputs: async (jobId: string, paths: string[]) => ({ dir: `/prof/plans/${jobId}/inputs`, names: paths.map((p) => p.split('/').pop()!) }),
    readIntakeText: async (file: string) => {
      if (file === '/p/docs/orchestrator/PLAN.md') return PLAN_MD
      const name = file.split('/').pop()!
      return files[name] ?? null
    }
  } as unknown as OrchServerDeps
  const person = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: '' }, cmd, args)
  const planner = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: PLANNER }, cmd, args)
  return { deps, person, planner, state: () => state }
}

const A = '# W9-A foundation\n\n**Run alone.** Tokens  and primitives.\r\n\n## Done means\n- tokens exist\n'
const B = '# W9-B\n\nAfter W9-A merges, the shell.\n'
const C = '# W9-C\n\nThe plan tab.\n'
const Z = '# W9-0\n\nThe mockup.\n'
const FILES = { 'W9-A-foundation.md': A, 'W9-B-shell.md': B, 'W9-C-plan-tab.md': C, 'W9-0-design-spec.md': Z }
const attach = Object.keys(FILES).map((n) => `/d/${n}`)

describe('jobs-create --mode prompts', () => {
  it('one Task per prompt file, verbatim, ordered by PLAN.md; a done wave skipped; approval is auto', async () => {
    const r = rig(FILES)
    const made = await r.person('jobs-create', { cwd: '/p', mode: 'prompts', attach, coordinatorAccount: 'acc1' })
    expect(made.status).toBe(200)
    const job = r.state().jobs[0]
    const tasks = r.state().tasks.filter((t) => t.jobId === job.id)
    expect(tasks.map((t) => [t.title, t.prompt, t.verbatimOf, t.accountIds])).toEqual([
      ['W9-A-foundation', A, 'W9-A-foundation.md', ['acc1']],
      ['W9-B-shell', B, 'W9-B-shell.md', ['acc1']],
      ['W9-C-plan-tab', C, 'W9-C-plan-tab.md', ['acc1']]
    ])
    const [ta, tb, tc] = tasks
    expect(ta.deps).toEqual([])
    expect(tb.deps).toEqual([ta.id])
    expect(tc.deps).toEqual([ta.id])
    expect(ta.spec).toBe('W9-A: wave 9.1, runs alone')
    expect(tb.spec).toBe('W9-B: wave 9.2, parallel with W9-C after wave 9.1')
    expect(job.autoApprove).toBe(true)
    expect(job.verbatim).toEqual([
      { title: 'W9-A-foundation', source: 'W9-A-foundation.md', sha256: sha256Of(A), taskId: ta.id },
      { title: 'W9-B-shell', source: 'W9-B-shell.md', sha256: sha256Of(B), taskId: tb.id },
      { title: 'W9-C-plan-tab', source: 'W9-C-plan-tab.md', sha256: sha256Of(C), taskId: tc.id },
      { title: 'W9-0-design-spec', source: 'W9-0-design-spec.md', sha256: sha256Of(Z), skipped: 'already done: wave 9.0 is marked done in PLAN.md' }
    ])
    expect(job.objective).toMatch(/^Run as written/)
    expect(job.objective).toContain('W9-0-design-spec.md: already done')
    expect(renderPlanMd(r.state(), job)).toContain('## Already done (skipped)\n\n- W9-0-design-spec.md: already done')
  })

  it('one Task per ## section of a pasted document, the heading its title', async () => {
    const r = rig({})
    const doc = 'Rules for all.\n\n## Fix login\nDo the login.\n\n## Fix search\nDo the search.\n'
    expect((await r.person('jobs-create', { cwd: '/p', mode: 'prompts', objective: doc })).status).toBe(200)
    const tasks = r.state().tasks
    expect(tasks.map((t) => [t.title, t.prompt])).toEqual([
      ['Fix login', '## Fix login\nDo the login.\n\n'],
      ['Fix search', '## Fix search\nDo the search.\n']
    ])
    expect(r.state().jobs[0].title).toBe('Fix login, Fix search')
  })

  it('--approve ask keeps the approval step; --approve without --mode prompts and a non-.md file are refused', async () => {
    const r = rig(FILES)
    await r.person('jobs-create', { cwd: '/p', mode: 'prompts', attach: ['/d/W9-C-plan-tab.md'], approve: 'ask' })
    expect(r.state().jobs[0].autoApprove).toBe(false)
    expect((await r.person('jobs-create', { cwd: '/p', objective: 'x', approve: 'ask' })).status).toBe(400)
    expect((await r.person('jobs-create', { cwd: '/p', mode: 'prompts', attach: ['/d/spec.pdf'] })).status).toBe(400)
  })
})

describe('a Run-as-written prompt is never rewritten', () => {
  const planned = async () => {
    const r = rig(FILES)
    const made = await r.person('jobs-create', { cwd: '/p', mode: 'prompts', attach, coordinatorAccount: 'acc1', approve: 'ask' })
    const jobId = (made.body as { id: string }).id
    expect((await r.person('jobs-plan', { id: jobId })).status).toBe(200)
    return { r, jobId, tasks: r.state().tasks.filter((t) => t.jobId === jobId) }
  }

  it('the planner may fill a Task in, but not add, cancel, retitle or rewrite one', async () => {
    const { r, jobId, tasks } = await planned()
    const fill = await r.planner('task-update', {
      id: tasks[0].id,
      criteria: ['tokens exist'],
      affectedPaths: ['src/renderer/src/tokens.css'],
      difficulty: 'hard',
      basis: 'missing',
      evidence: 'no tokens.css'
    })
    expect(fill.status).toBe(200)
    const rewrite = await r.planner('task-update', { id: tasks[0].id, prompt: 'A better prompt.' })
    expect(rewrite.status).toBe(403)
    expect((rewrite.body as { error: string }).error).toContain("a Run-as-written prompt is the owner's text")
    expect((await r.planner('task-update', { id: tasks[0].id, title: 'nicer' })).status).toBe(403)
    expect((await r.planner('task-create', { run: jobId, account: 'acc1', spec: 's', prompt: 'p', criteria: ['c'] })).status).toBe(403)
    expect((await r.planner('task-cancel', { id: tasks[2].id, reason: 'merged' })).status).toBe(403)
    expect(r.state().tasks.find((t) => t.id === tasks[0].id)!.prompt).toBe(A)
  })

  it('validatePlan refuses a changed prompt, a missing or doubled prompt and a Task from no prompt', async () => {
    const { r, jobId, tasks } = await planned()
    for (const t of tasks)
      await r.planner('task-update', { id: t.id, criteria: ['done'], basis: 'missing', evidence: 'x' })
    expect(validatePlan(r.state(), jobId)).toEqual([])
    // the person's own task-update is not a planner's, so only the approval check stops it
    expect((await r.person('task-update', { id: tasks[1].id, prompt: 'Rewritten.' })).status).toBe(200)
    expect(validatePlan(r.state(), jobId)).toEqual([
      "W9-B-shell's prompt was changed: a Run-as-written prompt is the owner's text, unchanged"
    ])
    const s = r.state()
    const extra = { ...tasks[2], id: 'tsk_extra', verbatimOf: undefined, deps: [] }
    const dropped = { ...s, tasks: [...s.tasks.filter((t) => t.id !== tasks[2].id), extra] }
    expect(validatePlan(dropped, jobId)).toEqual(
      expect.arrayContaining([
        'W9-C-plan-tab.md has 0 Tasks: a Run-as-written prompt is exactly one Task',
        "tsk_extra (W9-C-plan-tab) is not one of the owner's prompts: Run as written plans the attached prompts only"
      ])
    )
    // approval (run-start) holds on the same check
    const start = await r.person('run-start', { run: jobId })
    expect(start.status).toBeGreaterThanOrEqual(400)
  })
})
