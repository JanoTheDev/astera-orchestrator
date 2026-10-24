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
export function buildRepo(root) {
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
  return { repo, wt, branch: 'shots/settings-page', api: plain('api-server', 'src/server.js'), acme: plain('acme', 'web/index.js') }
}

/** Finished sessions for History: an account (`shots-seed`, never signed in) whose config folder holds Claude transcripts
 *  of the seeded projects, `projects/<cwd with / and . as ->/<session id>.jsonl`. Rebuilt each run with the repos. */
export function buildTranscripts(configDir, nowMs, repos) {
  const sessions = [
    [repos.repo, 'Add a settings page that saves to disk', 'I added the form and wired the save button.', 300],
    [repos.repo, 'Fix the failing save test in settings.test.ts', 'The test expected "saved"; the handler returned undefined. Fixed.', 200],
    [repos.repo, 'Why does the theme list start with night?', 'themes[0] is the default; see src/theme.js.', 95],
    [repos.api, 'Add a /health endpoint to the API server that reports the build version', 'Added GET /health returning { ok: true, version }.', 150],
    [repos.acme, 'Debounce the search input in the web app by 200 ms', 'Wrapped the handler in a 200 ms debounce.', 60]
  ]
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
export function seed(profile, nowMs = Date.now()) {
  profile = path.resolve(profile)
  const live = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'astera')
  if (profile === live) throw new Error(`refusing ${profile}: that is the profile Astera runs on`)
  const pid = hostAlive(profile)
  // The Host keeps orchestration.json in memory and writes it back: a seed under a live Host is lost or fights it
  if (pid) throw new Error(`a Host (pid ${pid}) serves ${profile}: quit the app and \`astera host stop\` first`)

  const { repo, wt, branch, api, acme } = buildRepo(path.join(profile, SEED_DIR))

  const orchFile = path.join(profile, 'orchestration.json')
  const state = seedState(readJson(orchFile, {}), repo, nowMs, { api, acme })
  writeJson(orchFile, state)
  // The store falls back to last-good when the main file is unreadable: keep it from resurrecting an older seed
  writeJson(`${orchFile}.last-good`, state)

  const wtFile = path.join(profile, 'worktrees.json')
  const reg = readJson(wtFile, { items: [] })
  const items = (reg.items ?? []).filter((w) => !w.path?.startsWith(path.join(profile, SEED_DIR) + path.sep))
  items.push({ id: `${SEED_TAG}0000-0000-4000-8000-000000000001`, repoPath: repo, path: wt, name: path.basename(wt), branch, baseRef: 'main', createdAt: new Date(nowMs).toISOString() })
  writeJson(wtFile, { ...reg, items })

  const configDir = path.join(profile, SEED_DIR, 'claude-home')
  buildTranscripts(configDir, nowMs, { repo, api, acme })
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
  const i = process.argv.indexOf('--profile')
  const profile = i >= 0 ? process.argv[i + 1] : undefined
  if (!profile) {
    console.error('Usage: node scripts/shots-seed.mjs --profile <dir>   (an ASTERA_PROFILE_DIR / --user-data-dir, never ~/.config/astera)')
    process.exit(2)
  }
  try {
    const out = seed(profile)
    for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(10)} ${v}`)
  } catch (err) {
    console.error(`shots-seed: ${err.message}`)
    process.exit(1)
  }
}
