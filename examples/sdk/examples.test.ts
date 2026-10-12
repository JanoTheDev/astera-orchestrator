// The SDK examples run the way a person runs them: plain Node strips their types, they import @astera-app/client by
// name from a node_modules holding only the built package, in a folder whose name has a space, and they reach a Host
// through ASTERA_PROFILE_DIR and ASTERA_HOST. The Host is the package's fake one, answering what each example sends.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-packages.mjs'
import { freshAddress, makeProfile, startHost, type FakeHost, type FakeReply } from '../../packages/client/test/fakeHost.js'
import { runTsc } from '../../packages/client/test/typecheck.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const EXAMPLES = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
const A = '0123456789ab'
const B = 'bbbbbbbbbbbb'
const ok = (body: unknown): FakeReply => ({ status: 200, body })

let work = ''
let dir = ''
let profile: Awaited<ReturnType<typeof makeProfile>>

beforeAll(async () => {
  work = mkdtempSync(path.join(os.tmpdir(), 'astera examples '))
  const dist = buildPackage('client', path.join(work, 'build'))
  dir = path.join(work, 'my scripts')
  const installed = path.join(dir, 'node_modules', '@astera-app', 'client')
  mkdirSync(installed, { recursive: true })
  cpSync(path.join(here, '..', '..', 'packages', 'client', 'package.json'), path.join(installed, 'package.json'))
  cpSync(dist, path.join(installed, 'dist'), { recursive: true })
  for (const f of [...EXAMPLES, 'package.json']) cpSync(path.join(here, f), path.join(dir, f))
  profile = await makeProfile()
}, 120_000)

afterAll(async () => {
  await profile?.cleanup()
  rmSync(work, { recursive: true, force: true })
})

type Answer = FakeReply | 'hang' | ((args: Record<string, unknown>) => FakeReply)
const hosts: FakeHost[] = []
const children: Array<{ kill(): void }> = []
const servers: http.Server[] = []

afterEach(async () => {
  for (const c of children.splice(0)) c.kill()
  for (const h of hosts.splice(0)) await h.close()
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r))
})

/** A Host that answers each command with the next of its answers, and holds a call it has none for. */
async function scriptedHost(answers: Record<string, Answer[]>): Promise<FakeHost> {
  const host = await startHost({
    key: profile.key,
    features: ['orch', 'requests', 'events'],
    onCall: (m, reply) => {
      const next = answers[m.cmd]?.shift()
      if (next === undefined || next === 'hang') return
      reply(typeof next === 'function' ? next(m.args) : next)
    }
  })
  hosts.push(host)
  return host
}

/** An example running in its own Node, with only the Host's two variables from the Astera ones. */
function run(file: string, args: string[], address: string, env: Record<string, string> = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ASTERA_')))
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', file, ...args], {
    cwd: dir,
    env: { ...clean, ASTERA_PROFILE_DIR: profile.dir, ASTERA_HOST: address, ...env }
  })
  let out = ''
  let err = ''
  child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c))
  child.stderr.setEncoding('utf8').on('data', (c: string) => (err += c))
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)))
  const kill = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
  children.push({ kill })
  return {
    out: () => out,
    err: () => err,
    exited,
    kill,
    /** Waits until what it printed matches. */
    shows: (re: RegExp) => vi.waitFor(() => expect(out).toMatch(re), { timeout: 15_000, interval: 20 }),
    type: (line: string) => child.stdin.write(`${line}\n`)
  }
}

/** A webhook receiver on 127.0.0.1: answers each post with the next status (200 when none is left). */
async function receiver(statuses: number[]): Promise<{ url: string; texts: string[] }> {
  const texts: string[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8').on('data', (c: string) => (body += c))
    req.on('end', () => {
      texts.push((JSON.parse(body) as { text: string }).text)
      res.statusCode = statuses.shift() ?? 200
      res.end()
    })
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, texts }
}

const JOB = { id: 'job_1', objective: 'Add a test', cwd: 'X', createdAt: 'T', outcome: 'pending', progress: { done: 0, total: 0 } }
const RUN = { id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: 'T', outcome: 'running', progress: { done: 0, total: 1 }, questionsOpen: 0 }
const ending = (state: string, extra: Record<string, unknown> = {}) => ({ state, runId: 'run_1', jobId: 'job_1', progress: { done: 1, total: 1 }, ...extra })
const question = (id: string, text: string, options?: string[]) => ({ id, runId: 'run_1', taskId: 't_1', question: text, status: 'open', createdAt: 'T', ...(options ? { options } : {}) })
const event = (id: string, n: number, type: string, payload: unknown) => ({ id, type, sequence: n, occurredAt: 'T', jobId: 'job_1', runId: 'run_1', payload })

describe('the SDK examples', () => {
  it('compile against the package with only erasable TypeScript', () => {
    expect(runTsc(path.join(here, 'tsconfig.json'))).toBe('')
  }, 60_000)

  it('import only @astera-app/client and Node built-ins, so a folder with the SDK installed runs them', () => {
    expect(EXAMPLES.sort()).toEqual(['answer-questions.ts', 'follow-a-run.ts', 'notify-webhook.ts', 'run-a-job.ts'])
    for (const f of EXAMPLES) {
      const specifiers = [...readFileSync(path.join(here, f), 'utf8').matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g)].map((m) => m[1] ?? m[2])
      expect(specifiers.filter((s) => s !== '@astera-app/client' && !s.startsWith('node:')), f).toEqual([])
    }
  })
})

describe('run-a-job.ts', () => {
  it('makes the Job in the folder given, runs it, waits again after a timeout, and exits 0 when it completed', async () => {
    const host = await scriptedHost({
      'jobs-create': [ok(JOB)],
      'jobs-run': [ok(RUN)],
      'runs-wait': [ok({ state: 'timeout', runId: 'run_1', jobId: 'job_1', progress: { done: 0, total: 1 } }), ok(ending('completed'))]
    })
    const r = run('run-a-job.ts', ['work', 'Add a test'], host.address)
    expect(await r.exited).toBe(0)
    expect(r.out()).toMatch(/completed: 1 of 1 tasks/)
    const calls = host.calls()
    expect(calls.map((c) => c.cmd)).toEqual(['jobs-create', 'jobs-run', 'runs-wait', 'runs-wait'])
    expect(calls[0].args).toEqual({ objective: 'Add a test', cwd: path.resolve(dir, 'work'), coordinatorProvider: 'claude' })
    expect(calls[0].request).toEqual(expect.any(String))
    expect(calls[1].request).toEqual(expect.any(String))
    expect(calls[1].request).not.toBe(calls[0].request)
  })

  it('lists what did not converge and exits 10 when the Run failed', async () => {
    const tasks = [
      { taskId: 't_1', title: 'Add tests', state: 'failed', attempt: 2, maxAttempts: 2, detail: null, failureSummary: 'npm test exited 1', lastFailure: 'npm test exited 1' },
      { taskId: 't_2', title: 'Write docs', state: 'converged', attempt: 0, maxAttempts: 2, detail: null, failureSummary: null, lastFailure: null }
    ]
    const host = await scriptedHost({
      'jobs-create': [ok(JOB)],
      'jobs-run': [ok(RUN)],
      'runs-wait': [ok(ending('failed'))],
      'runs-completion': [ok({ runId: 'run_1', jobId: 'job_1', state: 'failed', tasks })]
    })
    const r = run('run-a-job.ts', ['work', 'Add a test', 'codex'], host.address)
    expect(await r.exited).toBe(10)
    expect(r.out()).toMatch(/Add tests: failed \(npm test exited 1\)/)
    expect(r.out()).not.toMatch(/Write docs/)
    expect(host.calls()[0].args).toMatchObject({ coordinatorProvider: 'codex' })
  })

  it('shows the question and exits 8 when the Run waits for a person', async () => {
    const host = await scriptedHost({
      'jobs-create': [ok(JOB)],
      'jobs-run': [ok(RUN)],
      'runs-wait': [ok(ending('waiting', { questionId: 'q_1', taskId: 't_1' }))],
      'questions-get': [ok(question('q_1', 'Which database?'))]
    })
    const r = run('run-a-job.ts', ['work', 'Add a test'], host.address)
    expect(await r.exited).toBe(8)
    expect(r.out()).toMatch(/q_1: Which database\?/)
  })

  it('exits 3 and says so when no Host is running', async () => {
    const r = run('run-a-job.ts', ['work', 'Add a test'], await freshAddress())
    expect(await r.exited).toBe(3)
    expect(r.err()).toMatch(/HOST_NOT_RUNNING/)
  })

  it('exits 2 with its usage when an argument is missing or the provider is not one', async () => {
    for (const args of [['work'], ['work', 'x', 'gemini']]) {
      const r = run('run-a-job.ts', args, await freshAddress())
      expect(await r.exited).toBe(2)
      expect(r.err()).toMatch(/usage: node run-a-job\.ts/)
    }
  })
})

describe('follow-a-run.ts', () => {
  const step = (n: number, summary: string) => ({ at: `2026-10-12T10:0${n}:00.000Z`, kind: 'dispatch-started', sourceId: `d_${n}`, taskId: 't_1', taskTitle: 'Add tests', summary })
  const page = (events: unknown[], end: unknown = null): FakeReply => ok({ runId: 'run_1', jobId: 'job_1', count: events.length, progress: { done: 0, total: 1 }, events, ending: end })

  it('prints each event once, then the ending, and exits 0 when the Run completed', async () => {
    const host = await scriptedHost({ 'runs-follow': [page([step(1, 'claude started')]), page([step(1, 'claude started'), step(2, 'claude finished')], ending('completed'))] })
    const r = run('follow-a-run.ts', ['run_1'], host.address)
    expect(await r.exited).toBe(0)
    expect(r.out().match(/claude started/g)).toHaveLength(1)
    expect(r.out()).toMatch(/\[Add tests\] claude started[\s\S]*claude finished[\s\S]*ended: completed/)
  })

  it('exits 4 when there is no such Run', async () => {
    const host = await scriptedHost({ 'runs-follow': [{ status: 404, body: { error: 'unknown run: run_9' } }] })
    const r = run('follow-a-run.ts', ['run_9'], host.address)
    expect(await r.exited).toBe(4)
    expect(r.err()).toMatch(/NOT_FOUND: unknown run: run_9/)
  })
})

describe('answer-questions.ts', () => {
  it('takes the cursor, then the open questions, then each new one: once each, a number picks an option, an empty line skips', async () => {
    const answered = (resolution?: string) => (args: Record<string, unknown>): FakeReply =>
      ok({ ...question(String(args.id), 'x'), status: 'resolved', resolution: resolution ?? String(args.answer) })
    const host = await scriptedHost({
      'events-poll': [
        ok({ events: [], cursor: `ev_${A}_5`, gap: false }),
        ok({ events: [event(`ev_${A}_6`, 6, 'question.created', question('q_1', 'Which database?', ['Postgres', 'SQLite'])), event(`ev_${A}_7`, 7, 'question.created', question('q_2', 'Ship it?'))], cursor: `ev_${A}_7`, gap: false }),
        ok({ events: [], cursor: `ev_${A}_9`, gap: true }),
        'hang'
      ],
      'questions-list': [ok([question('q_1', 'Which database?', ['Postgres', 'SQLite'])]), ok([question('q_3', 'Delete the branch?')])],
      // q_2 was answered in the app first: the Host keeps that answer
      'questions-answer': [answered(), answered('no')]
    })
    const r = run('answer-questions.ts', [], host.address)
    await r.shows(/Which database\?\n {2}1\. Postgres\n {2}2\. SQLite\nanswer> $/)
    r.type('2')
    await r.shows(/Ship it\?\nanswer> $/)
    r.type('yes')
    await r.shows(/already answered: no[\s\S]*Delete the branch\?\nanswer> $/)
    r.type('')
    await r.shows(/skipped/)
    const calls = host.calls()
    expect(calls.filter((c) => c.cmd === 'questions-answer').map((c) => [c.args, c.request])).toEqual([
      [{ id: 'q_1', answer: 'SQLite' }, 'answer-q_1'],
      [{ id: 'q_2', answer: 'yes' }, 'answer-q_2']
    ])
    const polls = calls.filter((c) => c.cmd === 'events-poll')
    expect(polls[0].args).toEqual({ tail: true })
    expect(calls.findIndex((c) => c.cmd === 'events-poll')).toBeLessThan(calls.findIndex((c) => c.cmd === 'questions-list'))
    expect(polls[1].args).toMatchObject({ after: `ev_${A}_5`, types: 'question.created' })
    expect(calls.filter((c) => c.cmd === 'questions-list').map((c) => c.args)).toEqual([{ status: 'open' }, { status: 'open' }])
  }, 30_000)
})

describe('notify-webhook.ts', () => {
  const run1 = { ...RUN, outcome: 'completed', progress: { done: 2, total: 2 } }

  it('posts what needs attention, tries a failed post again, keeps its cursor, and reads on from it when started again', async () => {
    const hook = await receiver([500])
    const cursorFile = path.join(work, 'cursor one')
    const host = await scriptedHost({
      'events-poll': [
        ok({ events: [], cursor: `ev_${A}_3`, gap: false }),
        ok({ events: [event(`ev_${A}_4`, 4, 'run.completed', run1), event(`ev_${A}_6`, 6, 'question.created', question('q_1', 'Which database?'))], cursor: `ev_${A}_6`, gap: false }),
        'hang'
      ]
    })
    const first = run('notify-webhook.ts', [cursorFile], host.address, { WEBHOOK_URL: hook.url })
    await vi.waitFor(() => expect(readFileSync(cursorFile, 'utf8')).toBe(`ev_${A}_6`), { timeout: 15_000, interval: 20 })
    first.kill()
    await first.exited
    expect(hook.texts).toEqual([
      expect.stringMatching(/run_1 of job job_1 completed \(2 of 2 tasks\)/),
      expect.stringMatching(/run_1 of job job_1 completed/),
      expect.stringMatching(/A question needs a person: Which database\?/)
    ])

    const again = await scriptedHost({
      'events-poll': [ok({ events: [event(`ev_${B}_1`, 1, 'run.failed', { ...run1, id: 'run_2', outcome: 'failed' })], cursor: `ev_${B}_1`, gap: true }), 'hang']
    })
    const second = run('notify-webhook.ts', [cursorFile], again.address, { WEBHOOK_URL: hook.url })
    await vi.waitFor(() => expect(readFileSync(cursorFile, 'utf8')).toBe(`ev_${B}_1`), { timeout: 15_000, interval: 20 })
    second.kill()
    expect(again.calls()[0].args).toMatchObject({ after: `ev_${A}_6`, types: 'run.completed,run.failed,completion.exhausted,question.created' })
    expect(hook.texts.slice(3)).toEqual([expect.stringMatching(/events were lost/), expect.stringMatching(/run_2 of job job_1 failed/)])
  }, 30_000)

  it('stops without moving its cursor when the webhook keeps failing, so the next start posts that event again', async () => {
    const hook = await receiver([500, 500, 500, 500])
    const cursorFile = path.join(work, 'cursor two')
    writeFileSync(cursorFile, `ev_${A}_3`)
    const host = await scriptedHost({ 'events-poll': [ok({ events: [event(`ev_${A}_4`, 4, 'run.completed', run1)], cursor: `ev_${A}_4`, gap: false }), 'hang'] })
    const r = run('notify-webhook.ts', [cursorFile], host.address, { WEBHOOK_URL: hook.url })
    expect(await r.exited).toBe(1)
    expect(hook.texts).toHaveLength(4)
    expect(readFileSync(cursorFile, 'utf8')).toBe(`ev_${A}_3`)
    expect(r.err()).toMatch(/the next start posts it again/)
  }, 30_000)

  // SDK 1e smoke finding: saving only what it posted, a restart after a quiet spell read from a cursor the Host had
  // dropped, and posted "events were lost" though it had read everything
  it('saves the cursor past what its filter skipped while it waits, without posting', async () => {
    const hook = await receiver([])
    const cursorFile = path.join(work, 'cursor three')
    writeFileSync(cursorFile, `ev_${A}_3`)
    const host = await scriptedHost({ 'events-poll': [ok({ events: [], cursor: `ev_${A}_40`, gap: false }), 'hang'] })
    const r = run('notify-webhook.ts', [cursorFile], host.address, { WEBHOOK_URL: hook.url })
    await vi.waitFor(() => expect(readFileSync(cursorFile, 'utf8')).toBe(`ev_${A}_40`), { timeout: 15_000, interval: 50 })
    r.kill()
    expect(hook.texts).toEqual([])
  }, 30_000)

  it('exits 2 with its usage without WEBHOOK_URL', async () => {
    const r = run('notify-webhook.ts', [], await freshAddress())
    expect(await r.exited).toBe(2)
    expect(r.err()).toMatch(/usage: WEBHOOK_URL=/)
  })
})
