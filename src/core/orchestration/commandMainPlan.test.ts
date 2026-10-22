// T3: `astera main-plan`, read only: the project's plans in run order and how they meet.
import { describe, expect, it } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { humanFor } from './cliHuman'
import { plannerRefusal } from './planner'
import { emptyState, type OrchState } from './state'
import type { Job, JobRun, Task } from './types'

const T0 = '2026-10-18T00:00:00.000Z'
const job = (id: string, over: Partial<Job> = {}): Job => ({ id, objective: id, cwd: '/repo', projectId: 'prj_1', createdAt: T0, autoDispatch: true, concurrency: 3, ...over })
const run = (id: string, jobId: string): JobRun => ({ id, jobId, ordinal: 1, createdAt: T0 })
const task = (id: string, runId: string, over: Partial<Task> = {}): Task => ({
  id,
  runId,
  title: id.toUpperCase(),
  spec: 's',
  deps: [],
  status: 'ready',
  consecutiveFailures: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over
})

const state: OrchState = {
  ...emptyState(),
  projects: [
    { id: 'prj_1', name: 'one', path: '/repo' },
    { id: 'prj_2', name: 'two', path: '/two' }
  ] as OrchState['projects'],
  jobs: [job('jA', { title: 'Plan A' }), job('jB', { title: 'Plan B', plannerSessionIds: ['ses_p'] }), job('jC', { projectId: 'prj_2', cwd: '/two', title: 'Elsewhere' })],
  runs: [run('r1', 'jA'), run('r2', 'jB'), run('r3', 'jC')],
  tasks: [task('tA', 'r1', { affectedPaths: ['src/a.ts'] }), task('tB', 'r2', { deps: ['tA'], status: 'pending' }), task('tC', 'r3')]
}
const deps = { getState: () => state, setState: async () => undefined, now: () => T0 } as unknown as OrchServerDeps
const call = (sessionId: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId }, 'main-plan', args)

describe('main-plan', () => {
  it('--project gives that project’s main plan: plans in run order and the cross-plan link', async () => {
    const r = await call('', { project: 'prj_1' })
    expect(r.status).toBe(200)
    const body = r.body as { projectKey: string; plans: { job: { id: string } }[]; links: unknown[]; text: string }
    expect(body.projectKey).toBe('prj_1')
    expect(body.plans.map((p) => p.job.id)).toEqual(['jA', 'jB'])
    expect(body.links).toContainEqual(expect.objectContaining({ kind: 'dep', taskId: 'tB', otherTaskId: 'tA', why: 'not completed' }))
    // --human prints the brief's text
    expect(humanFor('main-plan', body as unknown as Record<string, unknown>)).toBe(body.text)
    expect(body.text).toContain('MAIN PLAN OF THIS PROJECT')
    expect(body.text).toContain('link: tB waits on tA (not completed)')
  })

  it('defaults to the project of the calling planner session, and asks for --project from a shell', async () => {
    expect(((await call('ses_p', {})).body as { projectKey: string }).projectKey).toBe('prj_1')
    expect((await call('', {})).status).toBe(400)
    expect((await call('', { project: 'prj_9' })).status).toBe(404)
  })

  it('is allowed from a planner session', () => {
    expect(plannerRefusal(state, 'ses_p', 'main-plan', {})).toBeNull()
  })
})
