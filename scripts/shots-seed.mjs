#!/usr/bin/env node
// Seeds a dev profile so screenshots reach every screen without real agents (docs/dev/shots/SEED.md): a scratch git
// repo with a worktree branch, registered as a project, two plans in inert states, an Inbox feed and a `bash` run config.
// Writes the profile's own stores in the app's shapes (orchestration.json, worktrees.json, windows.json,
// run-configs.json, orch/activity.jsonl); never runs the `astera` CLI. Re-running replaces only its own seed.
//
// Nothing here may make a Host dispatch, resume or deliver (no orchestration flag parks a Job outright):
// - plan A is finished (every Task terminal) with `deliveryState.state: 'failed'`, which `deliveryDue` never retries;
// - plan B is paused, held (`dispatchHold`) on a paused Run, with no autoDispatch, coordinator or planner and
//   `replan: 'off'`; its in-flight Dispatch is already closed `closedBy: 'pause'` (not a lost worker), its delivery is
//   preset `pending` (so `openCompletedRunPrs` writes nothing), and its open Gate says "ask me" (never auto-answered,
//   and it keeps the stall watchdog quiet).
// No Run has a `worktree`, so no wave merge or draft PR runs either.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Every seeded id carries this, so a re-run finds (and replaces) exactly its own records. */
export const SEED_TAG = '5eed'
const id = (prefix, n) => `${prefix}_${SEED_TAG}${String(n).padStart(12, '0')}`
export const IDS = {
  project: id('proj', 1),
  jobDone: id('job', 1),
  jobLive: id('job', 2),
  runDone: id('run', 1),
  runLive: id('run', 2),
  projectApi: id('proj', 2),
  projectAcme: id('proj', 3),
  projectWeb: id('proj', 4), // sub-project of the acme workspace (same path, parentId)
  jobShipped: id('job', 3),
  runShipped: id('run', 3)
}
const isSeed = (x) => typeof x?.id === 'string' && x.id.includes(`_${SEED_TAG}`)
const ORCH_LISTS = ['jobs', 'runs', 'tasks', 'dispatches', 'messages', 'deliveries', 'gates', 'projects']
const SEED_DIR = 'shots-seed'
const CONFIG_ID = 'shots-seed:bash'
const FEED_BOOT = `${SEED_TAG}00000000` // 12 hex: the event id's boot part (core/events/eventRing.ts)

/** The orchestration state with the seed in place of any earlier one; `repo` is the scratch repo, `nowMs` the clock. */
export function seedState(prev, repo, nowMs, extra = { api: repo, acme: repo }) {
  const at = (minAgo) => new Date(nowMs - minAgo * 60_000).toISOString()
  const base = Object.fromEntries(ORCH_LISTS.map((k) => [k, (Array.isArray(prev?.[k]) ? prev[k] : []).filter((x) => !isSeed(x))]))
  const t = (n, runId, title, status, extra = {}) => ({
    id: id('tsk', n),
    runId,
    title,
    spec: `${title}.`,
    prompt: `${title}. Keep the change small.`,
    acceptanceCriteria: [`${title} works and its test passes`],
    affectedPaths: ['src/'],
    deps: [],
    status,
    consecutiveFailures: 0,
    createdAt: at(120),
    updatedAt: at(30),
    ...extra
  })
  const closed = (n, taskId, outcome, minAgo, extra = {}) => ({
    id: id('dsp', n),
    taskId,
    provider: 'claude',
    accountId: 'shots-seed',
    sessionId: `00000000-5eed-4000-8000-${String(n).padStart(12, '0')}`,
    cwd: repo,
    specPath: path.join(repo, '.seed-spec.md'),
    startedAt: at(minAgo + 10),
    workerState: 'stopped',
    retained: false,
    ...(outcome ? { outcome } : {}),
    endedAt: at(minAgo),
    ...extra
  })
  const done = { result: 'Done; committed in its worktree.', mergedIntoPlanAt: at(60) }
  const tasks = [
    // plan A: finished, one Task failed for good, its delivery failed
    t(1, IDS.runDone, 'Add the settings form', 'completed', done),
    t(2, IDS.runDone, 'Validate the settings form', 'completed', { ...done, deps: [id('tsk', 1)] }),
    t(3, IDS.runDone, 'Save settings to disk', 'failed', {
      deps: [id('tsk', 1)],
      consecutiveFailures: 3,
      lastFailure: 'npm test failed: settings.test.ts expected "saved" but got undefined',
      result: 'Failed three times: the save test never passed.'
    }),
    // plan B: one done, one mid-flight (paused), one waiting on the owner, one waiting on deps
    t(4, IDS.runLive, 'Add the theme tokens', 'completed', done),
    t(5, IDS.runLive, 'Wire the toggle into the header', 'dispatched', { deps: [id('tsk', 4)] }),
    t(6, IDS.runLive, 'Pick the default theme', 'blocked', {
      // "ask me": the Host's auto-answerer leaves a Task's question to the owner (exec/autoAnswer.ts autoAnswerOf)
      spec: 'Pick the default theme. Ask me before choosing: this is the owner\'s call.',
      deps: [id('tsk', 4)]
    }),
    t(7, IDS.runLive, 'Document the toggle', 'pending', { deps: [id('tsk', 5), id('tsk', 6)] }),
    // plan C: in the acme workspace's web sub-project, finished and delivered
    t(8, IDS.runShipped, 'Add the search box', 'completed', done),
    t(9, IDS.runShipped, 'Debounce the search input', 'completed', { ...done, deps: [id('tsk', 8)] })
  ]
  const deliveryError = 'main moved on: origin/main has 2 commits this plan does not, and the push was refused'
  return {
    ...base,
    projects: [
      ...base.projects,
      { id: IDS.project, path: repo, name: path.basename(repo), addedAt: at(240), autoProjects: false },
      { id: IDS.projectApi, path: extra.api, name: 'api-server', addedAt: at(230), autoProjects: false },
      { id: IDS.projectAcme, path: extra.acme, name: 'acme', addedAt: at(220) },
      { id: IDS.projectWeb, path: extra.acme, name: 'web', parentId: IDS.projectAcme, focus: ['web/'], addedAt: at(215) }
    ],
    jobs: [
      ...base.jobs,
      { id: IDS.jobDone, title: 'Settings page', objective: 'Add a settings page that saves to disk', cwd: repo, projectId: IDS.project, createdAt: at(180), concurrency: 2, replan: 'off' },
      {
        id: IDS.jobLive,
        title: 'Dark mode toggle',
        objective: 'Add a dark mode toggle to the header',
        cwd: repo,
        projectId: IDS.project,
        createdAt: at(150),
        concurrency: 2,
        replan: 'off',
        paused: true,
        dispatchHold: true
      },
      { id: IDS.jobShipped, title: 'Search box', objective: 'Add a debounced search box to the web app', cwd: extra.acme, projectId: IDS.projectWeb, createdAt: at(200), concurrency: 2, replan: 'off' }
    ],
    runs: [
      ...base.runs,
      {
        id: IDS.runDone,
        jobId: IDS.jobDone,
        ordinal: 1,
        createdAt: at(170),
        delivery: { at: at(20), branch: 'main', error: deliveryError },
        deliveryState: { state: 'failed', attempts: 5, lastError: deliveryError, lastAttemptAt: at(20), lastCode: 'main-diverged' }
      },
      { id: IDS.runLive, jobId: IDS.jobLive, ordinal: 1, createdAt: at(140), paused: true, deliveryState: { state: 'pending', attempts: 0 } },
      { id: IDS.runShipped, jobId: IDS.jobShipped, ordinal: 1, createdAt: at(195), deliveryState: { state: 'delivered', attempts: 1, lastAttemptAt: at(50) } }
    ],
    tasks: [...base.tasks, ...tasks],
    dispatches: [
      ...base.dispatches,
      closed(1, id('tsk', 1), 'succeeded', 100),
      closed(2, id('tsk', 2), 'succeeded', 80),
      closed(3, id('tsk', 3), 'failed', 40),
      closed(4, id('tsk', 4), 'succeeded', 90),
      // ended by the pause: neither an open nor a lost worker, so the load and recovery leave it alone
      closed(5, id('tsk', 5), undefined, 25, { closedBy: 'pause' }),
      // the acme plan's workers ran in acme: a Dispatch in another project's folder makes that folder its finished Run's,
      // and the Run-end sweep then closed live sessions there (a demo-app planner)
      closed(6, id('tsk', 8), 'succeeded', 70, { cwd: extra.acme }),
      closed(7, id('tsk', 9), 'succeeded', 55, { cwd: extra.acme })
    ],
    messages: [
      ...base.messages,
      {
        id: id('msg', 1),
        runId: IDS.runDone,
        type: 'worker_done',
        taskId: id('tsk', 1),
        dispatchId: id('dsp', 1),
        subject: 'Added the settings form',
        body: 'Added the form and its test.',
        outcome: 'succeeded',
        answered: false,
        createdAt: at(100),
        ackedAt: at(99)
      },
      {
        id: id('msg', 2),
        runId: IDS.runDone,
        type: 'worker_done',
        taskId: id('tsk', 3),
        dispatchId: id('dsp', 3),
        subject: 'Could not make the save test pass',
        body: 'settings.test.ts still fails after three tries.',
        outcome: 'failed',
        answered: false,
        createdAt: at(40),
        ackedAt: at(39)
      }
    ],
    gates: [
      ...base.gates,
      {
        id: id('gat', 1),
        runId: IDS.runLive,
        taskId: id('tsk', 6),
        question: 'Which theme should new users see first? This changes what every user sees on first start.',
        options: ['Night', 'Day', 'Follow the system'],
        status: 'open',
        createdAt: at(15)
      }
    ]
  }
}

/** `--scale`: today's real volume on top of the small seed (docs/perf/README.md). Every plan sits in a state the Host's passes
 *  leave alone, the same shapes as plans A/B/C above: completed = delivered; "running" = paused and held, its in-flight
 *  Dispatch closed `closedBy: 'pause'`, one open "ask me" Gate; planned = paused and held, every Task pending. */
export const SCALE = { plans: 72, tasksPerPlan: 9, transcripts: 320 }
export function scaleState(state, repos, nowMs) {
  const at = (minAgo) => new Date(nowMs - minAgo * 60_000).toISOString()
  const projects = [
    { id: IDS.project, cwd: repos.repo },
    { id: IDS.projectApi, cwd: repos.api },
    { id: IDS.projectAcme, cwd: repos.acme },
    { id: IDS.projectWeb, cwd: repos.acme },
    { id: id('proj', 5), cwd: repos.mobile }
  ]
  const out = { ...state, projects: [...state.projects, { id: projects[4].id, path: repos.mobile, name: 'mobile-app', addedAt: at(210), autoProjects: false }] }
  const jobs = [], runs = [], tasks = [], dispatches = [], messages = [], deliveries = [], gates = []
  let n = 1000 // counter for ids; the small seed uses 1..9
  const next = () => ++n
  for (let p = 0; p < SCALE.plans; p++) {
    const proj = projects[p % projects.length]
    const kind = p % 9 < 5 ? 'completed' : p % 9 < 8 ? 'running' : 'planned'
    const jobId = id('job', 100 + p)
    const runId = id('run', 100 + p)
    const created = 9000 - p * 100 // minutes ago: older plans first
    const title = `Plan ${String(p + 1).padStart(2, '0')}: ${['Refactor', 'Add', 'Fix', 'Migrate', 'Document', 'Speed up'][p % 6]} ${['billing', 'search', 'auth', 'settings', 'exports', 'onboarding', 'sync', 'inbox'][p % 8]}`
    jobs.push({
      id: jobId, title, objective: `${title}, end to end`, cwd: proj.cwd, projectId: proj.id, createdAt: at(created + 30), concurrency: 2, replan: 'off',
      ...(kind === 'completed' ? {} : { paused: true, dispatchHold: true })
    })
    runs.push({
      id: runId, jobId, ordinal: 1, createdAt: at(created),
      ...(kind === 'completed' ? { deliveryState: { state: 'delivered', attempts: 1, lastAttemptAt: at(created - 200) } } : { paused: true, deliveryState: { state: 'pending', attempts: 0 } })
    })
    const taskIds = []
    for (let k = 0; k < SCALE.tasksPerPlan; k++) {
      const taskId = id('tsk', next())
      taskIds.push(taskId)
      const status = kind === 'completed' ? 'completed' : kind === 'planned' ? 'pending' : k < 4 ? 'completed' : k === 4 ? 'dispatched' : k === 5 ? 'blocked' : 'pending'
      const tTitle = `${title.split(': ')[1]} step ${k + 1}`
      tasks.push({
        id: taskId, runId, title: tTitle, spec: `${tTitle}.`, prompt: `${tTitle}. Keep the change small.`, acceptanceCriteria: [`${tTitle} works and its test passes`],
        affectedPaths: ['src/'], deps: k > 0 ? [taskIds[k - 1]] : [], status, consecutiveFailures: 0, createdAt: at(created), updatedAt: at(created - 90),
        ...(status === 'completed' ? { result: 'Done; committed in its worktree.', mergedIntoPlanAt: at(created - 80) } : {}),
        ...(status === 'blocked' ? { spec: `${tTitle}. Ask me before choosing: this is the owner's call.` } : {})
      })
      if (status === 'pending' || status === 'blocked') continue
      const ended = (num, outcome, ago, extra = {}) => ({
        id: id('dsp', num), taskId, provider: 'claude', accountId: 'shots-seed', sessionId: `00000000-5eed-4000-8000-${String(num).padStart(12, '0')}`, cwd: proj.cwd,
        specPath: path.join(repos.repo, '.seed-spec.md'), startedAt: at(ago + 10), workerState: 'stopped', retained: false, ...(outcome ? { outcome } : {}), endedAt: at(ago), ...extra
      })
      // a Task failed 0, 1 or 2 times before it passed: about two Dispatches per Task, as in the real data
      for (let f = 0; f < k % 3; f++) dispatches.push(ended(next() + 5000, 'failed', created - 20 - k))
      dispatches.push(status === 'dispatched' ? ended(next() + 5000, undefined, 25, { closedBy: 'pause' }) : ended(next() + 5000, 'succeeded', created - 40 - k))
      const dispatchId = dispatches.at(-1).id
      // ~7 messages per finished Task, batched three at a time into acked Deliveries
      const ids = []
      for (let m = 0; m < 7; m++) {
        const msgId = id('msg', next())
        ids.push(msgId)
        messages.push({
          id: msgId, runId, type: m === 6 ? 'worker_done' : 'status', taskId, dispatchId, subject: m === 6 ? `Finished ${tTitle}` : `${tTitle}: progress ${m + 1}`,
          body: `${tTitle}: step ${m + 1} of 7 done. Tests pass.`, ...(m === 6 ? { outcome: 'succeeded' } : {}), answered: false, createdAt: at(created - 30 - m), ackedAt: at(created - 29 - m)
        })
      }
      for (let b = 0; b < ids.length; b += 3) deliveries.push({ id: id('dlv', next()), runId, messageIds: ids.slice(b, b + 3), createdAt: at(created - 30), ackedAt: at(created - 29) })
    }
    // gates: one open "ask me" Gate per running plan (also keeps the stall watchdog quiet), resolved ones on the finished plans' Tasks
    if (kind === 'running') gates.push({ id: id('gat', next()), runId, taskId: taskIds[5], question: `Which option for ${title}? This changes what every user sees.`, options: ['A', 'B', 'Follow the system'], status: 'open', createdAt: at(15) })
    if (kind === 'completed')
      for (let g = 0; g < 4; g++) gates.push({ id: id('gat', next()), runId, taskId: taskIds[g], question: `Use the old or the new ${title.split(': ')[1]} flow?`, options: ['Old', 'New'], status: 'resolved', resolution: 'New', createdAt: at(created - 10), resolvedAt: at(created - 12) })
  }
  return { ...out, jobs: [...out.jobs, ...jobs], runs: [...out.runs, ...runs], tasks: [...out.tasks, ...tasks], dispatches: [...out.dispatches, ...dispatches], messages: [...out.messages, ...messages], deliveries: [...out.deliveries, ...deliveries], gates: [...out.gates, ...gates] }
}

/** Feed lines (orch/activity.jsonl) for the Inbox's "Handled for you", error rows included; numbered after `lastSeq`. */
export function seedFeed(lastSeq, nowMs) {
  const at = (minAgo) => new Date(nowMs - minAgo * 60_000).toISOString()
  const A = { jobId: IDS.jobDone, runId: IDS.runDone }
  const B = { jobId: IDS.jobLive, runId: IDS.runLive }
  const drafts = [
    [100, 'dispatch.exited', { ...A, taskId: id('tsk', 1) }, { title: 'Add the settings form', plan: 'Settings page', outcome: 'succeeded', workerState: 'stopped' }],
    [40, 'dispatch.exited', { ...A, taskId: id('tsk', 3) }, { title: 'Save settings to disk', plan: 'Settings page', outcome: 'failed', workerState: 'stopped' }],
    [39, 'task.status', { ...A, taskId: id('tsk', 3) }, { title: 'Save settings to disk', plan: 'Settings page', status: 'failed', from: 'dispatched' }],
    [20, 'run.pr', A, { title: 'Settings page', plan: 'Settings page', pr: { at: at(20), error: 'push refused: main moved on' } }],
    [15, 'gate.opened', { ...B, taskId: id('tsk', 6) }, { title: 'Pick the default theme', plan: 'Dark mode toggle', gateId: id('gat', 1), question: 'Which theme should new users see first?' }]
  ]
  return drafts.map(([minAgo, type, ids, payload], i) => {
    const sequence = lastSeq + i + 1
    return { id: `ev_${FEED_BOOT}_${sequence}`, type, sequence, occurredAt: at(minAgo), ...ids, payload }
  })
}

const readJson = (file, fallback) => {
  if (!existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, 'utf8')) // a store we cannot read stops the seed rather than being overwritten
}
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.seed-tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Shots Seed', '-c', 'user.email=shots-seed@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' })

/** The scratch repo: two commits on main, and a worktree branch one commit ahead (for Create PR). Rebuilt each run. */
export function buildRepo(root, scale = false) {
  rmSync(root, { recursive: true, force: true })
  const repo = path.join(root, 'demo-app')
  const wt = path.join(root, 'worktrees', 'settings-page')
  mkdirSync(path.join(repo, 'src'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(path.join(repo, 'README.md'), '# demo-app\n\nA scratch project seeded for screenshots.\n')
  writeFileSync(path.join(repo, 'package.json'), '{\n  "name": "demo-app",\n  "private": true,\n  "scripts": { "test": "node --test" }\n}\n')
  writeFileSync(path.join(repo, 'src', 'index.js'), 'export const greet = (name) => `Hello, ${name}`\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'Initial commit')
  writeFileSync(path.join(repo, 'src', 'theme.js'), "export const themes = ['night', 'day']\n")
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'Add theme list')
  git(repo, 'worktree', 'add', '-q', '-b', 'shots/settings-page', wt, 'main')
  writeFileSync(path.join(wt, 'src', 'settings.js'), 'export const defaults = { theme: \'night\' }\n')
  git(wt, 'add', '-A')
  git(wt, 'commit', '-q', '-m', 'Add settings defaults')
  // two more projects for the switcher: a plain one, and a workspace (its sub-project shares its path)
  const plain = (name, file) => {
    const dir = path.join(root, name)
    mkdirSync(path.join(dir, path.dirname(file)), { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    writeFileSync(path.join(dir, file), `// ${name}\n`)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'Initial commit')
    return dir
  }
  return { repo, wt, branch: 'shots/settings-page', api: plain('api-server', 'src/server.js'), acme: plain('acme', 'web/index.js'), ...(scale ? { mobile: plain('mobile-app', 'src/app.js') } : {}) }
}

/** Finished sessions for History: an account (`shots-seed`, never signed in) whose config folder holds Claude transcripts
 *  of the seeded projects, `projects/<cwd with / and . as ->/<session id>.jsonl`. Rebuilt each run with the repos. */
export function buildTranscripts(configDir, nowMs, repos, extra = 0) {
  const sessions = [
    [repos.repo, 'Add a settings page that saves to disk', 'I added the form and wired the save button.', 300],
    [repos.repo, 'Fix the failing save test in settings.test.ts', 'The test expected "saved"; the handler returned undefined. Fixed.', 200],
    [repos.repo, 'Why does the theme list start with night?', 'themes[0] is the default; see src/theme.js.', 95],
    [repos.api, 'Add a /health endpoint to the API server that reports the build version', 'Added GET /health returning { ok: true, version }.', 150],
    [repos.acme, 'Debounce the search input in the web app by 200 ms', 'Wrapped the handler in a 200 ms debounce.', 60]
  ]
  // --scale: a few hundred more finished sessions spread over the projects, so the History scan has real volume
  const dirs = Object.values(repos)
  for (let i = 0; i < extra; i++) sessions.push([dirs[i % dirs.length], `Session ${i + 1}: ${['Refactor', 'Add', 'Fix', 'Explain', 'Review'][i % 5]} the ${['parser', 'cache', 'router', 'form', 'queue', 'logger'][i % 6]}`, `Done with change ${i + 1}.`, 400 + i * 7])
  sessions.forEach(([cwd, ask, answer, minAgo], i) => {
    const dir = path.join(configDir, 'projects', cwd.replace(/[/\\.]/g, '-'))
    mkdirSync(dir, { recursive: true })
    const sessionId = `00000000-5eed-4000-9000-${String(i + 1).padStart(12, '0')}`
    const line = (type, uuid, parentUuid, text, ago) => JSON.stringify({ type, uuid, parentUuid, sessionId, cwd, isSidechain: false, timestamp: new Date(nowMs - ago * 60_000).toISOString(), message: { role: type, content: text } })
    writeFileSync(path.join(dir, `${sessionId}.jsonl`), [line('user', `u-${i}`, null, ask, minAgo), line('assistant', `a-${i}`, `u-${i}`, answer, minAgo - 3)].join('\n') + '\n')
  })
}

const hostAlive = (profile) => {
  try {
    const { pid } = JSON.parse(readFileSync(path.join(profile, 'host', 'host.pid'), 'utf8'))
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    process.kill(pid, 0)
    return pid
  } catch {
    return false
  }
}

/** Seeds `profile`. Returns what it made. Throws on the live profile or while a Host serves this one. */
export function seed(profile, nowMs = Date.now(), scale = false) {
  profile = path.resolve(profile)
  const live = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'astera')
  if (profile === live) throw new Error(`refusing ${profile}: that is the profile Astera runs on`)
  const pid = hostAlive(profile)
  // The Host keeps orchestration.json in memory and writes it back: a seed under a live Host is lost or fights it
  if (pid) throw new Error(`a Host (pid ${pid}) serves ${profile}: quit the app and \`astera host stop\` first`)

  const { repo, wt, branch, api, acme, mobile } = buildRepo(path.join(profile, SEED_DIR), scale)

  const orchFile = path.join(profile, 'orchestration.json')
  const small = seedState(readJson(orchFile, {}), repo, nowMs, { api, acme })
  const state = scale ? scaleState(small, { repo, api, acme, mobile }, nowMs) : small
  writeJson(orchFile, state)
  // The store falls back to last-good when the main file is unreadable: keep it from resurrecting an older seed
  writeJson(`${orchFile}.last-good`, state)

  const wtFile = path.join(profile, 'worktrees.json')
  const reg = readJson(wtFile, { items: [] })
  const items = (reg.items ?? []).filter((w) => !w.path?.startsWith(path.join(profile, SEED_DIR) + path.sep))
  items.push({ id: `${SEED_TAG}0000-0000-4000-8000-000000000001`, repoPath: repo, path: wt, name: path.basename(wt), branch, baseRef: 'main', createdAt: new Date(nowMs).toISOString() })
  writeJson(wtFile, { ...reg, items })

  const configDir = path.join(profile, SEED_DIR, 'claude-home')
  buildTranscripts(configDir, nowMs, { repo, api, acme, ...(scale ? { mobile } : {}) }, scale ? SCALE.transcripts : 0)
  const acctFile = path.join(profile, 'accounts.json')
  const accts = readJson(acctFile, { accounts: [] })
  writeJson(acctFile, { ...accts, accounts: [...(accts.accounts ?? []).filter((a) => a.id !== 'shots-seed'), { id: 'shots-seed', label: 'shots-seed', configDir, color: '#6aa3ff', createdAt: new Date(nowMs).toISOString() }] })

  const winFile = path.join(profile, 'windows.json')
  const win = readJson(winFile, { open: [], places: {} })
  writeJson(winFile, { ...win, open: [IDS.project, ...(win.open ?? []).filter((p) => p !== IDS.project)] })

  const cfgFile = path.join(profile, 'run-configs.json')
  const cfg = readJson(cfgFile, {})
  for (const k of Object.keys(cfg)) if (k.startsWith(path.join(profile, SEED_DIR))) delete cfg[k]
  cfg[repo] = [{ id: CONFIG_ID, name: 'bash', type: 'shell', command: 'bash' }]
  writeJson(cfgFile, cfg)

  // A profile with no settings file runs onboarding first; one that exists is left as it is
  const settingsFile = path.join(profile, 'app-settings.json')
  if (!existsSync(settingsFile)) writeJson(settingsFile, { firstRunAsked: true, orchAlwaysOnMigrated: true })

  const feedFile = path.join(profile, 'orch', 'activity.jsonl')
  const kept = existsSync(feedFile)
    ? readFileSync(feedFile, 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.includes(`"ev_${FEED_BOOT}_`))
    : []
  const lastSeq = kept.reduce((m, l) => {
    try {
      return Math.max(m, JSON.parse(l).sequence ?? 0)
    } catch {
      return m
    }
  }, 0)
  mkdirSync(path.dirname(feedFile), { recursive: true })
  writeFileSync(feedFile, [...kept, ...seedFeed(lastSeq, nowMs).map((e) => JSON.stringify(e))].map((l) => `${l}\n`).join(''))

  return { profile, repo, worktree: wt, branch, ...IDS, gateId: id('gat', 1), runConfig: CONFIG_ID }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scale = process.argv.includes('--scale')
  const i = process.argv.indexOf('--profile')
  const profile = i >= 0 ? process.argv[i + 1] : undefined
  if (!profile) {
    console.error('Usage: node scripts/shots-seed.mjs --profile <dir> [--scale]   (an ASTERA_PROFILE_DIR / --user-data-dir, never ~/.config/astera)')
    process.exit(2)
  }
  try {
    const out = seed(profile, Date.now(), scale)
    for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(10)} ${v}`)
  } catch (err) {
    console.error(`shots-seed: ${err.message}`)
    process.exit(1)
  }
}
