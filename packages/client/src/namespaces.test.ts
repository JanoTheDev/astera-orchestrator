// The typed namespaces against a fake Host: each method sends the command and arguments the public CLI sends
// (docs/superpowers/specs/2026-10-12-sdk-1c-command-reference.md §A), with the pre-reads MCP does, and answers in the
// DTO shapes (types.ts).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createAsteraClient, type AsteraClient } from './client.js'
import { AsteraError } from './errors.js'
import { makeProfile, startHost, type FakeHost, type FakeReply } from '../test/fakeHost.js'

let profile: Awaited<ReturnType<typeof makeProfile>>
beforeAll(async () => {
  profile = await makeProfile()
})
afterAll(async () => {
  await profile.cleanup()
})
const opened: Array<{ close(): unknown }> = []
afterEach(async () => {
  for (const o of opened.splice(0)) await o.close()
})

const PROJECT = { id: 'proj_1', path: 'D:\\work\\app', name: 'app', addedAt: 'T', internal: 1 }
const JOB = { id: 'job_1', objective: 'o', cwd: 'D:\\work\\app', createdAt: 'T', outcome: 'pending', progress: { done: 0, total: 0 }, questionsOpen: 0, internal: 1 }
const RUN = { id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: 'T', outcome: 'running', progress: { done: 0, total: 1 }, questionsOpen: 0, coordinatorStop: 'x' }
const ENDING = { runId: 'run_1', jobId: 'job_1', progress: { done: 1, total: 1 }, state: 'completed' }

/** A Host that answers each command from `answers` (404 for an unknown id) and records every call. */
const setup = async (answers: Record<string, (args: Record<string, unknown>) => FakeReply>): Promise<{ host: FakeHost; astera: AsteraClient }> => {
  const host = await startHost({
    key: profile.key,
    onCall: (m, reply) => reply(answers[m.cmd]?.(m.args) ?? { status: 501, body: { error: `unknown command ${m.cmd}` } })
  })
  opened.push(host)
  const astera = await createAsteraClient({ profileDir: profile.dir, address: host.address })
  opened.push(astera)
  return { host, astera }
}
const sent = (h: FakeHost): Array<[string, Record<string, unknown>, string | undefined]> => h.calls().map((c) => [c.cmd, c.args, c.request])
const ok = (body: unknown): FakeReply => ({ status: 200, body })
const rejection = async (p: Promise<unknown>): Promise<AsteraError> => {
  try {
    await p
  } catch (e) {
    if (e instanceof AsteraError) return e
    throw e
  }
  throw new Error('expected a rejection')
}

describe('astera.projects', () => {
  it('lists and gets projects in the public shape', async () => {
    const { host, astera } = await setup({ 'projects-list': () => ok([PROJECT]), 'projects-get': (a) => (a.id === 'proj_1' ? ok(PROJECT) : { status: 404, body: { error: 'unknown project' } }) })
    const { internal: _i, ...shaped } = PROJECT
    expect(await astera.projects.list()).toEqual({ items: [shaped] })
    expect(await astera.projects.get('proj_1')).toEqual(shaped)
    expect((await rejection(astera.projects.get('nope'))).code).toBe('NOT_FOUND')
    expect(sent(host)).toEqual([
      ['projects-list', {}, undefined],
      ['projects-get', { id: 'proj_1' }, undefined],
      ['projects-get', { id: 'nope' }, undefined]
    ])
  })
})

describe('astera.jobs', () => {
  const answers = {
    'projects-get': (a: Record<string, unknown>) => (a.id === 'proj_1' ? ok(PROJECT) : { status: 404, body: { error: 'unknown project: ' + String(a.id) } }),
    'jobs-list': () => ok([JOB]),
    'jobs-get': () => ok({ ...JOB, run: RUN }),
    'jobs-create': () => ok(JOB),
    'jobs-run': () => ok(RUN),
    'jobs-wait': () => ok(ENDING)
  }
  const { internal: _j, ...job } = JOB
  const { coordinatorStop: _c, ...run } = RUN

  it('lists Jobs, by status and by project (its folder looked up first)', async () => {
    const { host, astera } = await setup(answers)
    expect(await astera.jobs.list()).toEqual({ items: [job] })
    await astera.jobs.list({ status: 'running', projectId: 'proj_1' })
    expect(sent(host)).toEqual([
      ['jobs-list', {}, undefined],
      ['projects-get', { id: 'proj_1' }, undefined],
      ['jobs-list', { status: 'running', project: 'D:\\work\\app' }, undefined]
    ])
  })

  it('gets a Job with its Run folded in, both shaped', async () => {
    const { astera } = await setup(answers)
    expect(await astera.jobs.get('job_1')).toEqual({ ...job, run })
  })

  it('creates a Job in a project, mapping the coordinator and the convergence policy', async () => {
    const { host, astera } = await setup(answers)
    expect(await astera.jobs.create({ objective: 'Refactor', projectId: 'proj_1', coordinator: { accountId: 'acc_1' }, concurrency: 2, convergence: { maxFixAttempts: 2, blockingSeverity: 'medium' } }, { requestId: 'r-1' })).toEqual(job)
    await astera.jobs.create({ objective: 'Other', cwd: 'D:\\x', coordinator: { provider: 'codex' }, convergence: true })
    await astera.jobs.create({ objective: 'Bare', cwd: 'D:\\x' })
    expect(sent(host)).toEqual([
      ['projects-get', { id: 'proj_1' }, undefined],
      ['jobs-create', { objective: 'Refactor', cwd: 'D:\\work\\app', coordinatorAccount: 'acc_1', concurrency: 2, convergence: true, maxFixAttempts: 2, blockingSeverity: 'medium' }, 'r-1'],
      ['jobs-create', { objective: 'Other', cwd: 'D:\\x', coordinatorProvider: 'codex', convergence: true }, undefined],
      ['jobs-create', { objective: 'Bare', cwd: 'D:\\x' }, undefined]
    ])
  })

  it('creates nothing when the project is unknown', async () => {
    const { host, astera } = await setup(answers)
    const e = await rejection(astera.jobs.create({ objective: 'o', projectId: 'proj_nope' }))
    expect([e.code, e.message]).toEqual(['NOT_FOUND', 'unknown project: proj_nope'])
    expect(sent(host).map(([cmd]) => cmd)).toEqual(['projects-get'])
  })

  it('refuses an ambiguous or empty input before sending anything', async () => {
    const { host, astera } = await setup(answers)
    for (const input of [
      { objective: 'o', projectId: 'proj_1', cwd: 'D:\\x' },
      { objective: 'o' },
      { objective: '', cwd: 'D:\\x' },
      { objective: 'o', cwd: 'D:\\x', coordinator: { accountId: 'a', provider: 'claude' } },
      { objective: 'o', cwd: 'D:\\x', coordinator: { provider: 'gpt' } }
    ])
      expect((await rejection(astera.jobs.create(input as never))).code, JSON.stringify(input)).toBe('INVALID_ARGUMENTS')
    expect((await rejection(astera.jobs.get(''))).code).toBe('INVALID_ARGUMENTS')
    expect(sent(host)).toEqual([])
  })

  it('runs a Job (with a request id) and waits for it, the ending as data', async () => {
    const { host, astera } = await setup(answers)
    expect(await astera.jobs.run('job_1', { requestId: 'r-2' })).toEqual(run)
    expect(await astera.jobs.wait('job_1', { timeoutMs: 1000 })).toEqual(ENDING)
    expect(await astera.jobs.wait('job_1')).toEqual(ENDING)
    expect(sent(host)).toEqual([
      ['jobs-run', { id: 'job_1' }, 'r-2'],
      ['jobs-wait', { id: 'job_1', timeoutMs: 1000 }, undefined],
      ['jobs-wait', { id: 'job_1' }, undefined]
    ])
  })

  it('refuses a wait the timer cannot hold', async () => {
    const { host, astera } = await setup(answers)
    for (const bad of [0, -1, 1.5, Number.NaN, 3e9]) expect((await rejection(astera.jobs.wait('job_1', { timeoutMs: bad }))).code, String(bad)).toBe('INVALID_ARGUMENTS')
    expect(sent(host)).toEqual([])
  })
})
