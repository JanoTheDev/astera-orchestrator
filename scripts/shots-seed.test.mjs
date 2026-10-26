// The screenshot seed (scripts/shots-seed.mjs, docs/dev/shots/SEED.md): what it writes loads cleanly, reaches the
// screens it is for, and gives the Host nothing to dispatch, resume or deliver.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { seed, IDS, SHOWCASE_IDS, SHOWCASE_ACCOUNTS } from './shots-seed.mjs'
import { OrchestrationStore, interruptedResumes } from '../src/core/orchestration/store'
import { deliveryDue } from '../src/core/orchestration/delivery'
import { outcomeOfTasks } from '../src/core/orchestration/running'
import { appDriven, jobActive, workersAgainstCap } from '../src/core/orchestration/schedule'
import { taskBoardsOf } from '../src/core/orchestration/blocked'
import { afterQueued, afterStartsDue } from '../src/core/orchestration/after'
import { planApprovable, plansMissingReady } from '../src/core/orchestration/exec/plannerFeedback'
import { AccountUsageStore } from '../src/main/accountUsageStore'
import { runEndSessions } from '../src/core/orchestration/exec/runEnd'
import { runGatedForTask } from '../src/core/orchestration/state'
import { candidates } from '../src/core/recovery/candidates'
import { autoAnswerOf } from '../src/core/orchestration/exec/autoAnswer'

let profile
beforeEach(() => {
  profile = mkdtempSync(path.join(tmpdir(), 'shots-seed-'))
})
afterEach(() => rmSync(profile, { recursive: true, force: true }))

const json = (f) => JSON.parse(readFileSync(path.join(profile, f), 'utf8'))
const NOW = Date.parse('2026-10-22T12:00:00Z')

describe('shots seed', () => {
  it('builds a repo with a worktree branch one commit ahead of main, registered as the project', () => {
    const out = seed(profile, NOW)
    const ahead = execFileSync('git', ['rev-list', '--count', 'main..shots/settings-page'], { cwd: out.repo }).toString().trim()
    expect(ahead).toBe('1')
    expect(execFileSync('git', ['rev-list', '--count', 'main'], { cwd: out.repo }).toString().trim()).toBe('2')
    expect(json('orchestration.json').projects[0]).toMatchObject({ id: IDS.project, path: out.repo })
    const web = json('orchestration.json').projects.find((p) => p.id === IDS.projectWeb)
    expect(web).toMatchObject({ parentId: IDS.projectAcme, path: json('orchestration.json').projects.find((p) => p.id === IDS.projectAcme).path })
    expect(json('worktrees.json').items).toEqual([expect.objectContaining({ repoPath: out.repo, path: out.worktree, baseRef: 'main' })])
    expect(json('windows.json').open[0]).toBe(IDS.project)
    expect(json('run-configs.json')[out.repo]).toEqual([{ id: 'shots-seed:bash', name: 'bash', type: 'shell', command: 'bash' }])
    expect(json('app-settings.json').firstRunAsked).toBe(true)
  })

  it('loads through the store unchanged: no Dispatch closed, no Task interrupted, nothing pruned', async () => {
    seed(profile, Date.now())
    const store = new OrchestrationStore(path.join(profile, 'orchestration.json'))
    const r = await store.load()
    expect(r).toMatchObject({ recovered: false, unknownOutcomes: 0, pruned: 0, stuckInterruptions: 0, coordinatorsLost: 0 })
    expect(store.get().tasks.map((t) => t.status).sort()).toEqual(['blocked', 'completed', 'completed', 'completed', 'dispatched', 'failed', 'pending'].concat(['completed', 'completed']).sort())
  })

  it('gives the Host nothing to place, recover, deliver or auto-answer', () => {
    seed(profile, NOW)
    const s = json('orchestration.json')
    const [done, live] = [IDS.runDone, IDS.runLive].map((id) => s.runs.find((r) => r.id === id))
    const tasksOf = (run) => s.tasks.filter((t) => t.runId === run.id)
    expect(outcomeOfTasks(tasksOf(done), s.gates)).toBe('failed')
    expect(deliveryDue(done.deliveryState, NOW + 365 * 86_400_000)).toBe(false)
    expect(deliveryDue(live.deliveryState, NOW)).toBe(true) // pending: never acted on while the Run runs, and preset so nothing rewrites it
    expect(outcomeOfTasks(tasksOf(live), s.gates)).toBe('running')
    expect(jobActive(s.jobs.find((j) => j.id === IDS.jobLive))).toBe(false)
    expect(appDriven(s, live)).toBe(false)
    expect(appDriven(s, done)).toBe(false)
    expect(tasksOf(live).every((t) => runGatedForTask(s, t))).toBe(true)
    expect(candidates(s)).toEqual([])
    const g = s.gates.find((x) => x.status === 'open')
    expect(autoAnswerOf(s, g)).toBeNull()
  })

  it('leaves a new plan\'s planner in a seeded project alone: no finished seeded Run claims another project\'s folder', () => {
    seed(profile, NOW)
    const s = json('orchestration.json')
    // A planner of a plan not run yet, marked with its Job, at each seeded project's root
    const live = s.projects.map((p, i) => ({ id: `planner-${i}`, cwd: p.path, mark: 'job_new' }))
    expect(runEndSessions(s, live).flatMap((p) => p.close)).toEqual([])
  })

  it('shows Retry, It\'s already pushed and Dismiss for the finished plan (a failed delivery)', () => {
    seed(profile, NOW)
    const run = json('orchestration.json').runs.find((r) => r.id === IDS.runDone)
    expect(run.deliveryState.state).toBe('failed')
    expect(run.deliveryState.lastError).toMatch(/main moved on/)
  })

  it('is idempotent and keeps what is not its own', () => {
    writeFileSync(path.join(profile, 'orchestration.json'), JSON.stringify({ jobs: [], runs: [], tasks: [], dispatches: [], messages: [], deliveries: [], gates: [], projects: [{ id: 'proj_other', path: '/x', name: 'x', addedAt: 'z' }] }))
    writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({ theme: 'day' }))
    mkdirSync(path.join(profile, 'orch'))
    writeFileSync(path.join(profile, 'orch', 'activity.jsonl'), '{"id":"ev_aaaaaaaaaaaa_7","type":"watchdog","sequence":7,"occurredAt":"x","payload":{"title":"t"}}\n')
    seed(profile, NOW)
    const first = readFileSync(path.join(profile, 'orchestration.json'), 'utf8')
    seed(profile, NOW)
    expect(readFileSync(path.join(profile, 'orchestration.json'), 'utf8')).toBe(first)
    const s = json('orchestration.json')
    expect(s.projects.map((p) => p.id)).toEqual(['proj_other', IDS.project, IDS.projectApi, IDS.projectAcme, IDS.projectWeb])
    expect(s.jobs).toHaveLength(3)
    expect(json('worktrees.json').items).toHaveLength(1)
    expect(json('app-settings.json')).toEqual({ theme: 'day' })
    const feed = readFileSync(path.join(profile, 'orch', 'activity.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(feed[0].id).toBe('ev_aaaaaaaaaaaa_7')
    expect(feed.slice(1).map((e) => e.sequence)).toEqual([8, 9, 10, 11, 12])
  })

  it('refuses a profile a live Host serves', () => {
    mkdirSync(path.join(profile, 'host'))
    writeFileSync(path.join(profile, 'host', 'host.pid'), JSON.stringify({ pid: process.pid, startedAt: 'x', exe: process.execPath }))
    expect(() => seed(profile, NOW)).toThrow(/a Host \(pid/)
  })
})

describe('showcase seed (--showcase)', () => {
  const S = SHOWCASE_IDS
  const showcaseJobs = [S.jobRunning, S.jobPr, S.jobFailed, S.jobPaused, S.jobApproval, S.jobQueued, S.jobPushed]
  const runsOf = (s) => s.runs.filter((r) => showcaseJobs.includes(r.jobId))
  const tasksOfRun = (s, runId) => s.tasks.filter((t) => t.runId === runId)

  it('loads through the store unchanged: no Dispatch closed, no Task interrupted or gated, nothing pruned', async () => {
    seed(profile, Date.now(), false, true)
    const before = json('orchestration.json')
    const store = new OrchestrationStore(path.join(profile, 'orchestration.json'))
    const r = await store.load()
    expect(r).toMatchObject({ recovered: false, unknownOutcomes: 0, pruned: 0, staleValidations: 0, staleReviews: 0, stuckInterruptions: 0, coordinatorsLost: 0 })
    expect(store.get().tasks).toEqual(before.tasks)
    expect(store.get().gates).toEqual(before.gates)
    expect(store.get().dispatches).toEqual(before.dispatches)
  })

  it('writes seven plans in every state the plan list shows', () => {
    seed(profile, NOW, false, true)
    const s = json('orchestration.json')
    expect(s.jobs.filter((j) => showcaseJobs.includes(j.id))).toHaveLength(7)
    const run = (id) => s.runs.find((r) => r.id === id)
    const job = (id) => s.jobs.find((j) => j.id === id)
    // running: 3 steps (dependency layers), 10 Tasks done, in flight, in review, asking and waiting
    const running = tasksOfRun(s, S.runRunning)
    expect(running).toHaveLength(10)
    const depth = (t) => (t.deps.length === 0 ? 0 : 1 + Math.max(...t.deps.map((d) => depth(running.find((x) => x.id === d)))))
    expect(new Set(running.map(depth))).toEqual(new Set([0, 1, 2]))
    expect(new Set(running.map((t) => t.status))).toEqual(new Set(['completed', 'dispatched', 'reviewing', 'blocked', 'pending']))
    const boards = taskBoardsOf(s)
    expect(new Set(running.map((t) => boards.get(t.id).category))).toEqual(new Set(['done', 'queued', 'awaiting-review']))
    expect(new Set(running.map((t) => t.model))).toEqual(new Set(['haiku', 'sonnet', 'opus', 'gpt-5-codex']))
    expect(s.gates.filter((g) => g.runId === S.runRunning && g.status === 'open')).toHaveLength(1)
    // delivered as a pull request, delivered by a push, delivery failed
    expect(run(S.runPr)).toMatchObject({ pr: { number: 412, landed: 'merged' }, deliveryState: { state: 'delivered' } })
    expect(run(S.runPushed)).toMatchObject({ delivery: { branch: 'main' }, deliveryState: { state: 'delivered' } })
    expect(run(S.runFailed).deliveryState).toMatchObject({ state: 'failed', lastCode: 'main-diverged' })
    expect(outcomeOfTasks(tasksOfRun(s, S.runFailed), s.gates)).toBe('completed')
    // paused with an open Gate
    expect(job(S.jobPaused)).toMatchObject({ paused: true, dispatchHold: true })
    expect(s.gates.filter((g) => g.runId === S.runPaused && g.status === 'open')).toHaveLength(1)
    // awaiting approval, and queued behind it
    expect(planApprovable(s, job(S.jobApproval))).toBe(true)
    expect(afterQueued(job(S.jobQueued))).toBe(true)
    expect(job(S.jobQueued).after).toBe(S.jobApproval)
  })

  it('writes three accounts with usage the Accounts panel reads, summary cards, a feed, History and a worktree with changes', async () => {
    const out = seed(profile, NOW, false, true)
    const accounts = json('accounts.json').accounts
    expect(accounts.map((a) => [a.label, a.provider])).toEqual([['work', 'claude'], ['personal', 'claude'], ['team-codex', 'codex']])
    for (const a of accounts) expect(readFileSync(path.join(a.configDir, a.provider === 'codex' ? 'auth.json' : '.credentials.json'), 'utf8').trim()).toBe('{}')
    // three days on, the remembered readings still draw
    const usage = new AccountUsageStore(path.join(profile, 'account-usage.json'), () => NOW + 3 * 86_400_000)
    await usage.load()
    for (const a of accounts) {
      const want = SHOWCASE_ACCOUNTS.find((x) => x.id === a.id)
      expect(usage.get(a.configDir)).toMatchObject({ session: { usedPercent: want.session }, weekly: { usedPercent: want.weekly } })
    }
    const cards = json('summaries.json').summaries
    expect(cards.length).toBeGreaterThanOrEqual(10)
    expect(cards.every((c) => showcaseJobs.includes(c.jobId) && c.facts.files.length > 0)).toBe(true)
    const feed = readFileSync(path.join(profile, 'orch', 'activity.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(feed.length - 5).toBeGreaterThanOrEqual(15)
    expect(feed.length - 5).toBeLessThanOrEqual(25)
    expect(feed.map((e) => e.sequence)).toEqual(feed.map((_, i) => i + 1))
    const transcripts = execFileSync('find', [path.join(accounts[0].configDir, 'projects'), '-name', '*.jsonl']).toString().trim().split('\n')
    expect(transcripts.length).toBeGreaterThanOrEqual(20)
    expect(transcripts.length).toBeLessThanOrEqual(40)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: out.showcaseWorktree }).toString().trim().split('\n')).toHaveLength(2)
    expect(json('worktrees.json').items.map((w) => w.branch)).toEqual(['shots/settings-page', 'astera/checkout-layout'])
    expect(json('windows.json').open[0]).toBe(S.storefront)
  })

  it('gives the Host nothing to place, recover, resume, deliver, start or auto-answer', () => {
    seed(profile, NOW, false, true)
    const s = json('orchestration.json')
    for (const run of runsOf(s)) {
      expect(appDriven(s, run)).toBe(false)
      const state = run.deliveryState?.state
      // pending is preset on the held Runs only: never acted on while the Run runs, as in the small seed
      if (state === 'pending') expect(s.jobs.find((j) => j.id === run.jobId).paused).toBe(true)
      else expect(deliveryDue(run.deliveryState, NOW + 365 * 86_400_000)).toBe(false)
    }
    for (const id of [S.jobRunning, S.jobPaused, S.jobApproval, S.jobQueued]) expect(jobActive(s.jobs.find((j) => j.id === id))).toBe(false)
    expect(s.tasks.filter((t) => t.jobId === S.jobApproval)).toHaveLength(5) // the plan's own Tasks, no Run yet
    for (const t of s.tasks.filter((t) => !['completed', 'failed'].includes(t.status))) expect(runGatedForTask(s, t)).toBe(true)
    expect(candidates(s)).toEqual([])
    expect(interruptedResumes(s, new Date(NOW).toISOString())).toEqual({ revalidate: [], rereview: [], stuck: 0 })
    expect(afterStartsDue(s)).toEqual([])
    expect(plansMissingReady(s, new Set())).toEqual([])
    expect(workersAgainstCap(s)).toBe(0)
    expect(s.runs.some((r) => r.worktree || r.coordinatorSessionId)).toBe(false)
    const open = s.gates.filter((g) => g.status === 'open')
    expect(open.length).toBeGreaterThanOrEqual(3)
    for (const g of open) expect(autoAnswerOf(s, g)).toBeNull()
    const live = s.projects.map((p, i) => ({ id: `planner-${i}`, cwd: p.path, mark: 'job_new' }))
    expect(runEndSessions(s, live).flatMap((p) => p.close)).toEqual([])
  })

  it('is idempotent, refuses --scale with it, and a plain re-run drops it', () => {
    seed(profile, NOW, false, true)
    const first = readFileSync(path.join(profile, 'orchestration.json'), 'utf8')
    seed(profile, NOW, false, true)
    expect(readFileSync(path.join(profile, 'orchestration.json'), 'utf8')).toBe(first)
    expect(() => seed(profile, NOW, true, true)).toThrow(/do not combine/)
    seed(profile, NOW)
    const s = json('orchestration.json')
    expect(s.jobs).toHaveLength(3)
    expect(json('accounts.json').accounts.map((a) => a.id)).toEqual(['shots-seed'])
    expect(json('summaries.json').summaries).toEqual([])
    expect(json('account-usage.json')).toEqual({})
  })
})
