// The screenshot seed (scripts/shots-seed.mjs, docs/dev/shots/SEED.md): what it writes loads cleanly, reaches the
// screens it is for, and gives the Host nothing to dispatch, resume or deliver.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { seed, IDS } from './shots-seed.mjs'
import { OrchestrationStore } from '../src/core/orchestration/store'
import { deliveryDue } from '../src/core/orchestration/delivery'
import { outcomeOfTasks } from '../src/core/orchestration/running'
import { appDriven, jobActive } from '../src/core/orchestration/schedule'
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
