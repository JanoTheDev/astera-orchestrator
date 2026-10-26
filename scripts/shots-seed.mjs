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

/** `--showcase`: a busy, believable product team for the documentation shots (docs/dev/shots/SEED.md, "Showcase seed").
 *  Three more projects (storefront, payments-api, mobile-app), seven plans in every state the plan list shows, three
 *  accounts with usage, summary cards and a long feed. Every plan is one of the inert shapes above: "running" and paused
 *  plans are paused and held with their in-flight Dispatch closed `closedBy: 'pause'` and an open "ask me" Gate; the
 *  plan in review is a convergence plan, whose interrupted review the load and the resume sweep leave to a paused Run;
 *  the plan awaiting approval and the queued plan are `pendingStart` (no planner alive, approval set to ask, queued
 *  behind a plan that is not delivered); finished plans are delivered (pull request or push) or their delivery failed. */
export const SHOWCASE_IDS = {
  storefront: id('proj', 6),
  payments: id('proj', 7),
  mobile: id('proj', 8),
  jobRunning: id('job', 301),
  jobPr: id('job', 302),
  jobFailed: id('job', 303),
  jobPaused: id('job', 304),
  jobApproval: id('job', 305),
  jobQueued: id('job', 306),
  jobPushed: id('job', 307),
  runRunning: id('run', 301),
  runPr: id('run', 302),
  runFailed: id('run', 303),
  runPaused: id('run', 304),
  runPushed: id('run', 307)
}
/** The showcase accounts: ids in accounts.json, the names the person gave them, and their usage (percent used; weekly is
 *  the peak, so it is never below the 5-hour figure). */
export const SHOWCASE_ACCOUNTS = [
  { id: 'shots-seed-work', label: 'work', provider: 'claude', color: '#6aa3ff', email: 'dana@northwind.example', session: 42, weekly: 67 },
  { id: 'shots-seed-personal', label: 'personal', provider: 'claude', color: '#f5a35c', email: 'dana.k@mailbox.example', session: 12, weekly: 31 },
  { id: 'shots-seed-codex', label: 'team-codex', provider: 'codex', color: '#46c28e', email: 'team@northwind.example', session: 58, weekly: 81 }
]
const [WORK, PERSONAL, CODEX] = SHOWCASE_ACCOUNTS.map((a) => a.id)
const MODEL = { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus', codex: 'gpt-5-codex' }

/** The showcase plans' Tasks, by plan: [key, title, status, model, effort, account, files, deps (keys), extra]. */
const SHOWCASE_PLANS = [
  {
    key: 'running', job: SHOWCASE_IDS.jobRunning, run: SHOWCASE_IDS.runRunning, project: 'storefront', title: 'Checkout redesign',
    objective: 'Replace the three-step checkout with a one-page checkout that validates addresses and offers express pay',
    tasks: [
      ['cart', 'Extract the cart summary into its own component', 'completed', 'sonnet', 'medium', WORK, ['src/cart/CartSummary.tsx', 'src/cart/CartSummary.test.tsx', 'src/checkout/Checkout.tsx'], []],
      ['schema', 'Define the address form schema', 'completed', 'haiku', 'low', PERSONAL, ['src/checkout/addressSchema.ts', 'src/checkout/addressSchema.test.ts'], []],
      ['events', 'Map the checkout analytics events', 'completed', 'haiku', 'low', CODEX, ['src/analytics/checkoutEvents.ts', 'docs/analytics.md'], []],
      ['layout', 'Build the one-page checkout layout', 'dispatched', 'opus', 'high', WORK, ['src/checkout/CheckoutPage.tsx', 'src/checkout/checkout.css'], ['cart', 'schema']],
      ['address', 'Validate addresses against the shipping API', 'reviewing', 'sonnet', 'medium', PERSONAL, ['src/checkout/validateAddress.ts', 'src/api/shipping.ts', 'src/checkout/validateAddress.test.ts'], ['schema']],
      ['estimate', 'Show delivery estimates under each address', 'completed', 'sonnet', 'medium', CODEX, ['src/checkout/DeliveryEstimate.tsx', 'src/api/shipping.ts'], ['schema']],
      ['express', 'Pick the express-pay providers', 'blocked', 'sonnet', 'medium', WORK, ['src/payments/expressPay.ts'], ['cart']],
      ['wallets', 'Wire the Apple Pay and Google Pay buttons', 'pending', 'sonnet', 'high', WORK, ['src/payments/WalletButtons.tsx', 'src/payments/expressPay.ts'], ['express', 'layout']],
      ['e2e', 'Update the checkout end-to-end tests', 'pending', 'haiku', 'medium', CODEX, ['e2e/checkout.spec.ts'], ['layout', 'address']],
      ['notes', 'Write the checkout migration notes', 'pending', 'haiku', 'low', PERSONAL, ['docs/checkout-migration.md'], ['layout', 'estimate']]
    ]
  },
  {
    key: 'pr', job: SHOWCASE_IDS.jobPr, run: SHOWCASE_IDS.runPr, project: 'storefront', title: 'Order history export',
    objective: 'Let customers export their order history as CSV from the account page',
    tasks: [
      ['query', 'Add the order history query with paging', 'completed', 'sonnet', 'medium', WORK, ['src/orders/history.ts', 'src/orders/history.test.ts'], []],
      ['csv', 'Write the CSV encoder for orders', 'completed', 'haiku', 'low', CODEX, ['src/orders/toCsv.ts', 'src/orders/toCsv.test.ts'], []],
      ['button', 'Add the Export button to the account page', 'completed', 'sonnet', 'low', PERSONAL, ['src/account/OrdersTab.tsx'], ['query', 'csv']],
      ['docs', 'Document the export in the help center', 'completed', 'haiku', 'low', PERSONAL, ['docs/help/export-orders.md'], ['button']]
    ]
  },
  {
    key: 'failed', job: SHOWCASE_IDS.jobFailed, run: SHOWCASE_IDS.runFailed, project: 'payments', title: 'Refund webhooks',
    objective: 'Send signed webhooks when a refund is created, settled or reversed',
    tasks: [
      ['model', 'Add the refund event model', 'completed', 'sonnet', 'medium', CODEX, ['src/refunds/events.ts', 'migrations/0042_refund_events.sql'], []],
      ['sign', 'Sign webhook payloads with HMAC-SHA256', 'completed', 'opus', 'high', WORK, ['src/webhooks/sign.ts', 'src/webhooks/sign.test.ts'], []],
      ['send', 'Deliver webhooks with retries and backoff', 'completed', 'sonnet', 'high', WORK, ['src/webhooks/deliver.ts', 'src/webhooks/deliver.test.ts'], ['model', 'sign']],
      ['docs', 'Document the refund webhook payloads', 'completed', 'haiku', 'low', PERSONAL, ['docs/webhooks/refunds.md'], ['send']]
    ]
  },
  {
    key: 'paused', job: SHOWCASE_IDS.jobPaused, run: SHOWCASE_IDS.runPaused, project: 'payments', title: 'Card decline retries',
    objective: 'Retry soft card declines once with a fresh authorization, and tell the customer why a card failed',
    tasks: [
      ['codes', 'Classify decline codes as soft or hard', 'completed', 'sonnet', 'medium', CODEX, ['src/cards/declineCodes.ts', 'src/cards/declineCodes.test.ts'], []],
      ['messages', 'Write customer-facing decline messages', 'completed', 'haiku', 'low', PERSONAL, ['src/cards/declineMessages.ts'], ['codes']],
      ['retry', 'Retry soft declines with a fresh authorization', 'dispatched', 'opus', 'high', WORK, ['src/cards/authorize.ts', 'src/cards/retry.ts'], ['codes']],
      ['limit', 'Choose how many retries a card gets per day', 'blocked', 'sonnet', 'medium', WORK, ['src/cards/retryPolicy.ts'], ['codes']],
      ['metrics', 'Report retry outcomes to the metrics dashboard', 'pending', 'haiku', 'low', CODEX, ['src/metrics/cardRetries.ts'], ['retry', 'limit']]
    ]
  },
  {
    // planned, not started: its Tasks are the plan's own (jobId, no Run yet), as a planner writes them
    key: 'approval', job: SHOWCASE_IDS.jobApproval, project: 'mobile', title: 'Offline cart sync',
    objective: 'Keep the cart usable offline in the mobile app and sync it when the connection returns',
    tasks: [
      ['store', 'Persist the cart in local storage', 'pending', 'sonnet', 'medium', WORK, ['src/cart/cartStore.ts', 'src/cart/cartStore.test.ts'], []],
      ['queue', 'Queue cart changes made offline', 'pending', 'sonnet', 'high', WORK, ['src/sync/changeQueue.ts', 'src/sync/changeQueue.test.ts'], ['store']],
      ['merge', 'Merge the offline cart with the server cart', 'pending', 'opus', 'high', PERSONAL, ['src/sync/mergeCart.ts', 'src/sync/mergeCart.test.ts'], ['queue']],
      ['banner', 'Show an offline banner on the cart screen', 'pending', 'haiku', 'low', CODEX, ['src/screens/CartScreen.tsx'], ['store']],
      ['qa', 'Add the airplane-mode test to the QA checklist', 'pending', 'haiku', 'low', PERSONAL, ['docs/qa/offline.md'], ['merge', 'banner']]
    ]
  },
  {
    key: 'queued', job: SHOWCASE_IDS.jobQueued, project: 'mobile', title: 'Push notification settings',
    objective: 'Let users choose which order updates arrive as push notifications', tasks: []
  },
  {
    key: 'pushed', job: SHOWCASE_IDS.jobPushed, run: SHOWCASE_IDS.runPushed, project: 'storefront', title: 'Product search filters',
    objective: 'Add price, brand and rating filters to product search',
    tasks: [
      ['facets', 'Return facet counts from the search API', 'completed', 'sonnet', 'medium', CODEX, ['src/search/facets.ts', 'src/search/facets.test.ts'], []],
      ['panel', 'Build the filter side panel', 'completed', 'sonnet', 'medium', WORK, ['src/search/FilterPanel.tsx', 'src/search/filterPanel.css'], ['facets']],
      ['url', 'Keep the chosen filters in the URL', 'completed', 'haiku', 'low', PERSONAL, ['src/search/filterParams.ts', 'src/search/filterParams.test.ts'], ['panel']]
    ]
  }
]

export function showcaseState(state, repos, nowMs) {
  const at = (minAgo) => new Date(nowMs - minAgo * 60_000).toISOString()
  const S = SHOWCASE_IDS
  const cwdOf = { storefront: repos.storefront, payments: repos.payments, mobile: repos.mobile }
  const projOf = { storefront: S.storefront, payments: S.payments, mobile: S.mobile }
  const projects = [
    { id: S.storefront, path: repos.storefront, name: 'storefront', addedAt: at(9000), autoProjects: false },
    { id: S.payments, path: repos.payments, name: 'payments-api', addedAt: at(8900), autoProjects: false },
    { id: S.mobile, path: repos.mobile, name: 'mobile-app', addedAt: at(8800), autoProjects: false }
  ]
  const jobs = [], runs = [], tasks = [], dispatches = [], messages = [], gates = []
  let n = 3000 // ids above the small seed (1..9) and below --scale (1000.., 6000..); the two are never combined
  const next = () => ++n
  SHOWCASE_PLANS.forEach((plan, p) => {
    const cwd = cwdOf[plan.project]
    const created = [190, 2900, 1500, 420, 60, 35, 4300][p] // minutes ago
    const finished = plan.key === 'pr' || plan.key === 'failed' || plan.key === 'pushed'
    const held = plan.key === 'running' || plan.key === 'paused'
    const pending = plan.key === 'approval' || plan.key === 'queued'
    jobs.push({
      id: plan.job, title: plan.title, objective: plan.objective, cwd, projectId: projOf[plan.project], createdAt: at(created + 20),
      concurrency: 3, replan: 'off', models: { coordinator: 'opus', planner: 'opus', worker: 'sonnet', reviewer: 'sonnet' },
      ...(plan.key === 'pr' ? { delivery: 'pr' } : plan.key === 'pushed' || plan.key === 'failed' ? { delivery: 'push' } : {}),
      ...(held ? { paused: true, dispatchHold: true } : {}),
      // the plan in review: a convergence plan (its review restarts on resume, and never while its Run is paused)
      ...(plan.key === 'running' ? { convergence: {}, review: true } : {}),
      ...(plan.key === 'approval'
        ? { pendingStart: true, autoApprove: false, plannerSessionIds: ['00000000-5eed-4000-a000-000000000305'], planReadyAt: at(40), planning: 'chat' }
        : {}),
      ...(plan.key === 'queued' ? { pendingStart: true, autoApprove: false, after: S.jobApproval } : {})
    })
    if (plan.tasks.length === 0) return
    const deliveryError = 'main moved on: origin/main has 3 commits this plan does not, and the push was refused'
    if (plan.run) runs.push({
      id: plan.run, jobId: plan.job, ordinal: 1, createdAt: at(created),
      ...(held ? { paused: true, deliveryState: { state: 'pending', attempts: 0 } } : {}),
      ...(plan.key === 'pr'
        ? {
            pr: { at: at(created - 180), url: 'https://github.com/northwind/storefront/pull/412', number: 412, landed: 'merged' },
            deliveryState: { state: 'delivered', attempts: 1, lastAttemptAt: at(created - 180) }
          }
        : {}),
      ...(plan.key === 'pushed'
        ? { delivery: { at: at(created - 240), branch: 'main', sha: '4f2a9c1e7b3d5a60c8e1f2b49d07a3c5e6f81b2d' }, deliveryState: { state: 'delivered', attempts: 1, lastAttemptAt: at(created - 240) } }
        : {}),
      ...(plan.key === 'failed'
        ? {
            delivery: { at: at(created - 200), branch: 'main', error: deliveryError },
            deliveryState: { state: 'failed', attempts: 5, lastError: deliveryError, lastAttemptAt: at(created - 200), lastCode: 'main-diverged' }
          }
        : {})
    })
    const idOf = new Map(plan.tasks.map(([key]) => [key, id('tsk', next())]))
    plan.tasks.forEach(([key, title, status, model, effort, account, files, deps], k) => {
      const taskId = idOf.get(key)
      const ago = created - 15 - k * 9
      const owner = key === 'express' || key === 'limit'
      const codex = account === CODEX
      const modelId = codex ? MODEL.codex : MODEL[model]
      const task = {
        id: taskId, ...(plan.run ? { runId: plan.run } : { jobId: plan.job }), title,
        spec: owner ? `${title}. Ask me before choosing: this is the owner's call.` : `${title}.`,
        prompt: `${title}. Keep the change focused on ${files[0]} and the files next to it; add or update the tests.`,
        acceptanceCriteria: [`${title}: done as described`, 'npm test passes'],
        affectedPaths: files, deps: deps.map((d) => idOf.get(d)), status, consecutiveFailures: 0,
        model: modelId, effort, provider: codex ? 'codex' : 'claude', difficulty: model === 'opus' ? 'hard' : model === 'haiku' ? 'light' : 'standard',
        modelReason: model === 'opus' ? 'Touches several modules and needs careful judgement.' : model === 'haiku' ? 'A small, well-defined change.' : 'A normal feature-sized change.',
        accountIds: [account], createdAt: at(created), updatedAt: at(Math.max(ago, 5)),
        ...(plan.run ? {} : { basis: { state: 'missing', evidence: `${files[0]} does not exist yet` } })
      }
      if (status === 'completed')
        Object.assign(task, { result: `${title}: done, tests pass.`, filesModified: files, changedFiles: files, mergedIntoPlanAt: at(Math.max(ago - 5, 4)), links: { commits: [title] } })
      // reviewer notes: none blocking, so they read as advice on a finished Task
      if (key === 'estimate')
        task.reviewIssues = [
          { id: 'r1', severity: 'low', blocking: false, title: 'Estimate text is not localised', description: 'The "Arrives in N days" string is built in code; move it to the catalog.', file: 'src/checkout/DeliveryEstimate.tsx', line: 28, suggestedFix: 'Use t("checkout.arrivesIn", { days })' },
          { id: 'r2', severity: 'info', blocking: false, title: 'Cache the carrier lookup', description: 'getCarrier is called once per address; memoise it per postcode.', file: 'src/api/shipping.ts', line: 61 }
        ]
      tasks.push(task)
      if (status === 'pending' || status === 'blocked') return
      const ended = (outcome, minAgo, extra = {}) => {
        const num = next()
        return {
          id: id('dsp', num), taskId, provider: codex ? 'codex' : 'claude', accountId: account,
          sessionId: `00000000-5eed-4000-8000-${String(num).padStart(12, '0')}`, cwd, specPath: path.join(cwd, '.seed-spec.md'),
          startedAt: at(minAgo + 12), workerState: 'stopped', retained: false, model: modelId, effort,
          ...(outcome ? { outcome } : {}), endedAt: at(minAgo), ...extra
        }
      }
      // the second Task of each plan, and the Task the detail shot opens, needed a second try: a failed attempt each
      if (k === 1 || key === 'estimate') dispatches.push(ended('failed', ago + 30))
      if (status === 'dispatched') dispatches.push(ended(undefined, 8, { closedBy: 'pause', startedAt: at(26) }))
      else dispatches.push(ended('succeeded', ago))
      const last = dispatches.at(-1)
      // the reviewed Task's reviewer ran and approved; the Task in review waits for its reviewer to start
      if (key === 'estimate') dispatches.push(ended('succeeded', Math.max(ago - 6, 3), { review: true, model: 'sonnet', provider: 'claude', accountId: PERSONAL }))
      if (status === 'completed' || status === 'reviewing')
        messages.push({
          id: id('msg', next()), runId: plan.run, type: 'worker_done', taskId, dispatchId: last.id, subject: `Finished: ${title}`,
          body: `${title}. Changed ${files.join(', ')}. npm test passes.`, outcome: 'succeeded', answered: false, createdAt: at(Math.max(ago, 3)), ackedAt: at(Math.max(ago - 1, 2))
        })
    })
    const gate = (taskKey, question, options) =>
      gates.push({ id: id('gat', 300 + gates.length + 1), runId: plan.run, taskId: idOf.get(taskKey), question, options, status: 'open', createdAt: at(created - 70) })
    if (plan.key === 'running') gate('express', 'Which express-pay providers should checkout offer at launch? This decides which merchant accounts we need.', ['Apple Pay and Google Pay', 'Apple Pay only', 'PayPal as well'])
    if (plan.key === 'paused') gate('limit', 'How many times may a declined card be retried per day? This changes what customers are charged for.', ['Once', 'Twice', 'Never retry'])
  })
  return {
    ...state,
    projects: [...state.projects, ...projects],
    jobs: [...state.jobs, ...jobs], runs: [...state.runs, ...runs], tasks: [...state.tasks, ...tasks],
    // the small seed's workers ran on the account the showcase keeps its History in
    dispatches: [...state.dispatches.map((d) => (d.accountId === 'shots-seed' ? { ...d, accountId: WORK } : d)), ...dispatches], messages: [...state.messages, ...messages], gates: [...state.gates, ...gates]
  }
}

/** The showcase's feed lines for "Handled for you", numbered after `lastSeq`: finished and failed agents, a rolled
 *  account, answered questions, a pull request, a push and a failed delivery. */
export function showcaseFeed(state, lastSeq, nowMs) {
  const at = (minAgo) => new Date(nowMs - minAgo * 60_000).toISOString()
  const S = SHOWCASE_IDS
  const task = (title) => state.tasks.find((t) => t.title === title && t.id.includes(`_${SEED_TAG}`))
  const on = (jobId, runId, plan) => (title, extra = {}) => [{ jobId, runId, ...(task(title) ? { taskId: task(title).id } : {}) }, { title, plan, ...extra }]
  const R = on(S.jobRunning, S.runRunning, 'Checkout redesign')
  const P = on(S.jobPr, S.runPr, 'Order history export')
  const F = on(S.jobFailed, S.runFailed, 'Refund webhooks')
  const D = on(S.jobPaused, S.runPaused, 'Card decline retries')
  const U = on(S.jobPushed, S.runPushed, 'Product search filters')
  const drafts = [
    [4380, 'plan.delivered', ...U('Product search filters', { branch: 'main', sha: '4f2a9c1e7b3d' })],
    [3120, 'dispatch.exited', ...P('Write the CSV encoder for orders', { outcome: 'failed', workerState: 'failed' })],
    [3080, 'question.auto-answered', ...P('Write the CSV encoder for orders', { question: 'Quote every field or only fields with commas?', answer: 'Only fields that need it (RFC 4180)', answeredBy: 'coordinator' })],
    [2930, 'run.pr', ...P('Order history export', { pr: { at: at(2930), url: 'https://github.com/northwind/storefront/pull/412', number: 412 } })],
    [1720, 'plan.done', ...F('Refund webhooks', { runOutcome: 'completed' })],
    [1700, 'run.pr', ...F('Refund webhooks', { pr: { at: at(1700), error: 'push refused: main moved on' } })],
    [470, 'dispatch.exited', ...D('Classify decline codes as soft or hard', { outcome: 'succeeded', workerState: 'stopped' })],
    [455, 'account.switched', ...D('Write customer-facing decline messages', { title: PERSONAL, fromAccountId: CODEX, reason: 'team-codex was nearly spent for this window' })],
    [430, 'dispatch.exited', ...D('Write customer-facing decline messages', { outcome: 'succeeded', workerState: 'stopped' })],
    [350, 'gate.opened', ...D('Choose how many retries a card gets per day', { question: 'How many times may a declined card be retried per day?' })],
    [175, 'dispatch.exited', ...R('Extract the cart summary into its own component', { outcome: 'succeeded', workerState: 'stopped' })],
    [168, 'dispatch.exited', ...R('Define the address form schema', { outcome: 'failed', workerState: 'failed' })],
    [160, 'question.auto-answered', ...R('Define the address form schema', { question: 'Should postcode be required for every country?', answer: 'No: only where the country uses postcodes', answeredBy: 'coordinator' })],
    [150, 'dispatch.exited', ...R('Define the address form schema', { outcome: 'succeeded', workerState: 'stopped' })],
    [140, 'dispatch.exited', ...R('Map the checkout analytics events', { outcome: 'succeeded', workerState: 'stopped' })],
    [130, 'dispatch.started', ...R('Build the one-page checkout layout')],
    [120, 'gate.opened', ...R('Pick the express-pay providers', { question: 'Which express-pay providers should checkout offer at launch?' })],
    [112, 'dispatch.exited', ...R('Show delivery estimates under each address', { outcome: 'succeeded', workerState: 'stopped' })],
    [105, 'dispatch.exited', ...R('Show delivery estimates under each address', { outcome: 'succeeded', workerState: 'stopped', review: true })],
    [95, 'task.status', ...R('Validate addresses against the shipping API', { status: 'reviewing', category: 'awaiting-review', from: 'dispatched' })],
    [40, 'plan.awaiting-approval', { jobId: S.jobApproval }, { title: 'Offline cart sync', plan: 'Offline cart sync' }]
  ]
  return drafts.map(([minAgo, type, ids, payload], i) => {
    const sequence = lastSeq + i + 1
    return { id: `ev_${FEED_BOOT}_${sequence}`, type, sequence, occurredAt: at(minAgo), ...ids, payload }
  })
}

/** Summary cards (summaries.json) for the showcase's finished Tasks: the plan board's one-liners and the Task detail. */
export function showcaseSummaries(state) {
  const jobOfRun = new Map(state.runs.map((r) => [r.id, r.jobId]))
  const showcaseJobs = new Set(Object.entries(SHOWCASE_IDS).filter(([k]) => k.startsWith('job')).map(([, v]) => v))
  return state.tasks
    .filter((t) => t.status === 'completed' && showcaseJobs.has(jobOfRun.get(t.runId)))
    .map((t) => {
      const d = state.dispatches.filter((x) => x.taskId === t.id && !x.review && x.outcome === 'succeeded').at(-1)
      const reviewed = state.dispatches.some((x) => x.taskId === t.id && x.review)
      return {
        sessionId: d.sessionId, jobId: jobOfRun.get(t.runId), taskId: t.id, at: d.endedAt, outcome: 'merged',
        durationMs: Date.parse(d.endedAt) - Date.parse(d.startedAt),
        facts: {
          role: 'worker', title: t.title,
          files: t.filesModified.map((f, i) => ({ path: f, added: 12 + i * 17, removed: i * 4 })),
          checks: [{ name: 'npm test', status: 'passed' }, { name: 'lint', status: 'passed' }],
          review: { rounds: reviewed ? 1 : 0, verdict: reviewed ? 'approved' : 'none' },
          questions: { coordinator: 0, owner: 0 },
          commits: [t.title]
        },
        text: `${t.title}. The change touches ${t.filesModified.length} files and its tests pass.`,
        model: 'haiku'
      }
    })
}

/** The showcase's History: finished sessions over the three projects, [repo key, ask, answer, minutes ago]. */
export const SHOWCASE_SESSIONS = [
  ['storefront', 'Why does the cart total flicker when a coupon is applied?', 'The total re-renders before the discount request settles; I kept the old total until the response arrives.', 30],
  ['storefront', 'Explain how CartSummary gets its line items', 'It reads them from useCart(), which subscribes to the cart store; nothing is passed down as props.', 75],
  ['storefront', 'Add a skeleton loader to the product grid', 'Added ProductGridSkeleton with 8 placeholder cards; it shows while the first page loads.', 140],
  ['storefront', 'Review the checkout layout PR for accessibility', 'Two issues: the step headings skip a level, and the pay button has no accessible name while loading.', 260],
  ['storefront', 'Find where the shipping estimate is cached', 'src/api/shipping.ts keeps a per-postcode Map that is never cleared; it lives for the whole session.', 380],
  ['storefront', 'Rename the "basket" variables to "cart"', 'Renamed 31 occurrences in 9 files; the public API names were already "cart".', 520],
  ['storefront', 'Write a test for the coupon code input', 'Added CouponInput.test.tsx: empty, invalid, expired and valid codes.', 700],
  ['storefront', 'Speed up the product search page', 'The facet counts were fetched once per facet; one request now returns them all. First load went from 1.8 s to 0.6 s.', 980],
  ['storefront', 'Upgrade the router to the next minor version', 'Upgraded; the only change needed was the renamed useNavigation import.', 1400],
  ['payments-api', 'Why do refund webhooks arrive twice?', 'The retry fired before the first delivery timed out. The retry now waits for the request to settle.', 55],
  ['payments-api', 'Add an index for refunds by merchant and date', 'Added migration 0043 with a (merchant_id, created_at) index; the refunds list query uses it.', 210],
  ['payments-api', 'Explain the decline code mapping', 'declineCodes.ts maps each processor code to soft or hard; soft declines may be retried once.', 450],
  ['payments-api', 'Make the HMAC signature check constant time', 'Switched to crypto.timingSafeEqual and added a test with signatures of different lengths.', 900],
  ['payments-api', 'Document the /refunds endpoint', 'Wrote docs/api/refunds.md with the request, the response and every error code.', 1250],
  ['payments-api', 'Fix the flaky settlement test', 'It depended on the wall clock; the test now injects a fixed clock.', 1900],
  ['payments-api', 'List the endpoints that still use the old auth middleware', 'Four: /charges/legacy, /payouts, /reports/daily and /webhooks/test.', 2600],
  ['mobile-app', 'Why is the cart empty after the app restarts?', 'The cart lived only in memory; the offline sync plan persists it.', 45],
  ['mobile-app', 'Add pull to refresh on the orders screen', 'Added a RefreshControl that reloads the first page of orders.', 320],
  ['mobile-app', 'Fix the keyboard covering the address form', 'Wrapped the form in KeyboardAvoidingView and scroll the focused field into view.', 610],
  ['mobile-app', 'Explain how push tokens are registered', 'registerPush() asks for permission, then posts the token to /devices; it runs on every app start.', 1100],
  ['mobile-app', 'Reduce the app bundle size', 'Dropped moment for date-fns and lazy-loaded the map screen: 1.2 MB smaller.', 2100],
  ['mobile-app', 'Write a release note for version 3.4', 'Wrote the 3.4 notes: saved carts, faster search and the new order history.', 3300]
]

/** Writes the showcase accounts under `root`: each a config folder with an empty credentials file (no token, so the
 *  usage probe never calls a provider) and, for claude, its email. Returns the accounts.json entries. */
export function buildShowcaseAccounts(root, nowMs) {
  return SHOWCASE_ACCOUNTS.map((a) => {
    const configDir = path.join(root, 'accounts', a.label)
    mkdirSync(configDir, { recursive: true })
    writeFileSync(path.join(configDir, a.provider === 'codex' ? 'auth.json' : '.credentials.json'), '{}\n')
    if (a.provider === 'claude') writeFileSync(path.join(configDir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: a.email } }, null, 2))
    return { id: a.id, label: a.label, configDir, color: a.color, createdAt: new Date(nowMs).toISOString(), provider: a.provider, email: a.email }
  })
}

/** account-usage.json entries (the last reading the Accounts panel remembers) for the showcase accounts, by config folder. */
export function showcaseUsage(accounts, nowMs) {
  const iso = (h) => new Date(nowMs + h * 3_600_000).toISOString()
  return Object.fromEntries(
    accounts.map((acct) => {
      const a = SHOWCASE_ACCOUNTS.find((x) => x.id === acct.id)
      // the reading is kept until its peak's reset (accountUsageStore.ts): the weekly one, days out, so a later shot has it
      return [acct.configDir, {
        session: { usedPercent: a.session, resetsAt: iso(2.5) },
        weekly: { usedPercent: a.weekly, resetsAt: iso(100) },
        peak: { percent: a.weekly, resetsAt: iso(100), weekly: true },
        readAt: new Date(nowMs - 4 * 60_000).toISOString()
      }]
    })
  )
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

/** The showcase repos' files: a few real-looking sources per project, so Explorer and the editor have something to show. */
const SHOWCASE_FILES = {
  storefront: {
    'README.md': '# storefront\n\nThe Northwind web shop: product search, cart and checkout.\n\n```bash\nnpm install\nnpm run dev\n```\n',
    'package.json': '{\n  "name": "storefront",\n  "private": true,\n  "scripts": { "dev": "vite", "test": "vitest run", "lint": "eslint src" }\n}\n',
    'src/cart/CartSummary.tsx':
      "import { useCart } from './useCart'\nimport { formatPrice } from '../format'\n\n/** The cart's lines and total, shown beside the checkout form. */\nexport function CartSummary() {\n  const { lines, total } = useCart()\n  return (\n    <aside className=\"cart-summary\" aria-label=\"Order summary\">\n      <ul>\n        {lines.map((line) => (\n          <li key={line.sku}>\n            <span>{line.name} × {line.quantity}</span>\n            <span>{formatPrice(line.price * line.quantity)}</span>\n          </li>\n        ))}\n      </ul>\n      <p className=\"cart-summary__total\">Total {formatPrice(total)}</p>\n    </aside>\n  )\n}\n",
    'src/checkout/Checkout.tsx': "import { CartSummary } from '../cart/CartSummary'\nimport { AddressForm } from './AddressForm'\n\nexport function Checkout() {\n  return (\n    <main className=\"checkout\">\n      <AddressForm />\n      <CartSummary />\n    </main>\n  )\n}\n",
    'src/checkout/addressSchema.ts':
      "import { z } from 'zod'\n\n/** Countries that use postcodes require one; the rest may leave it empty. */\nexport const addressSchema = z.object({\n  name: z.string().min(1),\n  line1: z.string().min(1),\n  line2: z.string().optional(),\n  city: z.string().min(1),\n  postcode: z.string().optional(),\n  country: z.string().length(2)\n})\n\nexport type Address = z.infer<typeof addressSchema>\n",
    'src/api/shipping.ts': "const carriers = new Map<string, string>()\n\nexport async function estimateDays(postcode: string): Promise<number> {\n  const res = await fetch(`/api/shipping/estimate?postcode=${encodeURIComponent(postcode)}`)\n  if (!res.ok) throw new Error(`estimate failed: ${res.status}`)\n  return (await res.json()).days\n}\n",
    'src/search/facets.ts': "export interface Facet { name: string; counts: Record<string, number> }\n\nexport const FACETS = ['price', 'brand', 'rating'] as const\n"
  },
  'payments-api': {
    'README.md': '# payments-api\n\nCharges, refunds and webhooks for Northwind.\n',
    'package.json': '{\n  "name": "payments-api",\n  "private": true,\n  "scripts": { "start": "node dist/server.js", "test": "vitest run" }\n}\n',
    'src/webhooks/sign.ts': "import { createHmac, timingSafeEqual } from 'node:crypto'\n\nexport const sign = (secret: string, body: string): string => createHmac('sha256', secret).update(body).digest('hex')\n\nexport function verify(secret: string, body: string, signature: string): boolean {\n  const want = Buffer.from(sign(secret, body))\n  const got = Buffer.from(signature)\n  return want.length === got.length && timingSafeEqual(want, got)\n}\n",
    'src/cards/declineCodes.ts': "export type DeclineKind = 'soft' | 'hard'\n\nexport const DECLINES: Record<string, DeclineKind> = {\n  insufficient_funds: 'soft',\n  processing_error: 'soft',\n  stolen_card: 'hard',\n  expired_card: 'hard'\n}\n"
  },
  'mobile-app': {
    'README.md': '# mobile-app\n\nThe Northwind shopping app for iOS and Android.\n',
    'package.json': '{\n  "name": "mobile-app",\n  "private": true,\n  "scripts": { "start": "expo start", "test": "jest" }\n}\n',
    'src/screens/CartScreen.tsx': "import { View, Text } from 'react-native'\nimport { useCart } from '../cart/useCart'\n\nexport function CartScreen() {\n  const { lines } = useCart()\n  return (\n    <View>\n      <Text>{lines.length} items</Text>\n    </View>\n  )\n}\n"
  }
}

/** The scratch repo: two commits on main, and a worktree branch one commit ahead (for Create PR). Rebuilt each run.
 *  `showcase` adds the storefront, payments-api and mobile-app repos, and a storefront worktree with uncommitted changes. */
export function buildRepo(root, scale = false, showcase = false) {
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
  const out = { repo, wt, branch: 'shots/settings-page', api: plain('api-server', 'src/server.js'), acme: plain('acme', 'web/index.js'), ...(scale ? { mobile: plain('mobile-app', 'src/app.js') } : {}) }
  if (!showcase) return out
  const filled = (name) => {
    const dir = path.join(root, name)
    for (const [file, text] of Object.entries(SHOWCASE_FILES[name])) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      writeFileSync(path.join(dir, file), text)
    }
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'Initial commit')
    return dir
  }
  const storefront = filled('storefront')
  // the running plan's layout Task, mid-change: one commit on its branch and edits not committed yet (Source Control)
  const showcaseWt = path.join(root, 'worktrees', 'checkout-layout')
  git(storefront, 'worktree', 'add', '-q', '-b', 'astera/checkout-layout', showcaseWt, 'main')
  writeFileSync(path.join(showcaseWt, 'src', 'checkout', 'CheckoutPage.tsx'), "import { Checkout } from './Checkout'\n\n/** One page: address, delivery and payment side by side. */\nexport const CheckoutPage = () => <Checkout />\n")
  git(showcaseWt, 'add', '-A')
  git(showcaseWt, 'commit', '-q', '-m', 'Add the one-page checkout shell')
  writeFileSync(path.join(showcaseWt, 'src', 'checkout', 'checkout.css'), '.checkout {\n  display: grid;\n  grid-template-columns: 2fr 1fr;\n  gap: 24px;\n}\n')
  writeFileSync(path.join(showcaseWt, 'src', 'checkout', 'Checkout.tsx'), SHOWCASE_FILES.storefront['src/checkout/Checkout.tsx'].replace('<main className="checkout">', '<main className="checkout checkout--one-page">'))
  return { ...out, storefront, payments: filled('payments-api'), mobile: filled('mobile-app'), showcaseWt, showcaseBranch: 'astera/checkout-layout' }
}

/** Finished sessions for History: an account (`shots-seed`, never signed in) whose config folder holds Claude transcripts
 *  of the seeded projects, `projects/<cwd with / and . as ->/<session id>.jsonl`. Rebuilt each run with the repos. */
export function buildTranscripts(configDir, nowMs, repos, extra = 0, more = []) {
  const sessions = [
    [repos.repo, 'Add a settings page that saves to disk', 'I added the form and wired the save button.', 300],
    [repos.repo, 'Fix the failing save test in settings.test.ts', 'The test expected "saved"; the handler returned undefined. Fixed.', 200],
    [repos.repo, 'Why does the theme list start with night?', 'themes[0] is the default; see src/theme.js.', 95],
    [repos.api, 'Add a /health endpoint to the API server that reports the build version', 'Added GET /health returning { ok: true, version }.', 150],
    [repos.acme, 'Debounce the search input in the web app by 200 ms', 'Wrapped the handler in a 200 ms debounce.', 60]
  ]
  // --scale: a few hundred more finished sessions spread over the projects, so the History scan has real volume
  const dirs = Object.values(repos)
  sessions.push(...more)
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

/** Seeds `profile`. Returns what it made. Throws on the live profile or while a Host serves this one.
 *  `scale` (benchmark volume) and `showcase` (the documentation shots) each add to the small seed; not both. */
export function seed(profile, nowMs = Date.now(), scale = false, showcase = false) {
  if (scale && showcase) throw new Error('--scale and --showcase do not combine: pick one')
  profile = path.resolve(profile)
  const live = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'astera')
  if (profile === live) throw new Error(`refusing ${profile}: that is the profile Astera runs on`)
  const pid = hostAlive(profile)
  // The Host keeps orchestration.json in memory and writes it back: a seed under a live Host is lost or fights it
  if (pid) throw new Error(`a Host (pid ${pid}) serves ${profile}: quit the app and \`astera host stop\` first`)

  const repos = buildRepo(path.join(profile, SEED_DIR), scale, showcase)
  const { repo, wt, branch, api, acme, mobile } = repos

  const orchFile = path.join(profile, 'orchestration.json')
  const small = seedState(readJson(orchFile, {}), repo, nowMs, { api, acme })
  const state = scale ? scaleState(small, { repo, api, acme, mobile }, nowMs) : showcase ? showcaseState(small, repos, nowMs) : small
  writeJson(orchFile, state)
  // The store falls back to last-good when the main file is unreadable: keep it from resurrecting an older seed
  writeJson(`${orchFile}.last-good`, state)

  const wtFile = path.join(profile, 'worktrees.json')
  const reg = readJson(wtFile, { items: [] })
  const items = (reg.items ?? []).filter((w) => !w.path?.startsWith(path.join(profile, SEED_DIR) + path.sep))
  items.push({ id: `${SEED_TAG}0000-0000-4000-8000-000000000001`, repoPath: repo, path: wt, name: path.basename(wt), branch, baseRef: 'main', createdAt: new Date(nowMs).toISOString() })
  if (showcase)
    items.push({ id: `${SEED_TAG}0000-0000-4000-8000-000000000002`, repoPath: repos.storefront, path: repos.showcaseWt, name: path.basename(repos.showcaseWt), branch: repos.showcaseBranch, baseRef: 'main', createdAt: new Date(nowMs).toISOString() })
  writeJson(wtFile, { ...reg, items })

  // --showcase: three accounts with usage replace the one never-signed-in account, and History lives in "work"
  const showcaseAccounts = showcase ? buildShowcaseAccounts(path.join(profile, SEED_DIR), nowMs) : []
  const configDir = showcase ? showcaseAccounts[0].configDir : path.join(profile, SEED_DIR, 'claude-home')
  const byKey = { storefront: repos.storefront, 'payments-api': repos.payments, 'mobile-app': repos.mobile }
  const more = showcase ? SHOWCASE_SESSIONS.map(([key, ask, answer, minAgo]) => [byKey[key], ask, answer, minAgo]) : []
  buildTranscripts(configDir, nowMs, { repo, api, acme, ...(scale ? { mobile } : {}) }, scale ? SCALE.transcripts : 0, more)
  const acctFile = path.join(profile, 'accounts.json')
  const accts = readJson(acctFile, { accounts: [] })
  const seeded = showcase ? showcaseAccounts : [{ id: 'shots-seed', label: 'shots-seed', configDir, color: '#6aa3ff', createdAt: new Date(nowMs).toISOString() }]
  writeJson(acctFile, { ...accts, accounts: [...(accts.accounts ?? []).filter((a) => !a.id?.startsWith('shots-seed')), ...seeded] })
  const usageFile = path.join(profile, 'account-usage.json')
  const usage = readJson(usageFile, {})
  for (const k of Object.keys(usage)) if (k.startsWith(path.join(profile, SEED_DIR))) delete usage[k]
  if (showcase || existsSync(usageFile)) writeJson(usageFile, { ...usage, ...showcaseUsage(showcaseAccounts, nowMs) })
  const summariesFile = path.join(profile, 'summaries.json')
  const cards = readJson(summariesFile, { version: 1, summaries: [] })
  const keptCards = (cards.summaries ?? []).filter((c) => !c.sessionId?.includes(SEED_TAG))
  if (showcase || existsSync(summariesFile)) writeJson(summariesFile, { ...cards, version: 1, summaries: [...keptCards, ...(showcase ? showcaseSummaries(state) : [])] })

  const winFile = path.join(profile, 'windows.json')
  const win = readJson(winFile, { open: [], places: {} })
  const first = showcase ? SHOWCASE_IDS.storefront : IDS.project
  writeJson(winFile, { ...win, open: [first, ...(win.open ?? []).filter((p) => p !== first && p !== IDS.project), ...(showcase ? [IDS.project] : [])] })

  const cfgFile = path.join(profile, 'run-configs.json')
  const cfg = readJson(cfgFile, {})
  for (const k of Object.keys(cfg)) if (k.startsWith(path.join(profile, SEED_DIR))) delete cfg[k]
  cfg[repo] = [{ id: CONFIG_ID, name: 'bash', type: 'shell', command: 'bash' }]
  if (showcase)
    cfg[repos.storefront] = [
      { id: 'shots-seed:dev', name: 'dev server', type: 'shell', command: 'npm run dev' },
      { id: 'shots-seed:test', name: 'unit tests', type: 'shell', command: 'npm test' },
      { id: 'shots-seed:lint', name: 'lint', type: 'shell', command: 'npm run lint' },
      { id: 'shots-seed:shell', name: 'bash', type: 'shell', command: 'bash' }
    ]
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
  const smallFeed = seedFeed(lastSeq, nowMs)
  const lines = [...smallFeed, ...(showcase ? showcaseFeed(state, lastSeq + smallFeed.length, nowMs) : [])]
  writeFileSync(feedFile, [...kept, ...lines.map((e) => JSON.stringify(e))].map((l) => `${l}\n`).join(''))

  return { profile, repo, worktree: wt, branch, ...IDS, gateId: id('gat', 1), runConfig: CONFIG_ID, ...(showcase ? { ...SHOWCASE_IDS, showcaseWorktree: repos.showcaseWt, accounts: showcaseAccounts.map((a) => a.label).join(', ') } : {}) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scale = process.argv.includes('--scale')
  const showcase = process.argv.includes('--showcase')
  const i = process.argv.indexOf('--profile')
  const profile = i >= 0 ? process.argv[i + 1] : undefined
  if (!profile) {
    console.error('Usage: node scripts/shots-seed.mjs --profile <dir> [--scale | --showcase]   (an ASTERA_PROFILE_DIR / --user-data-dir, never ~/.config/astera)')
    process.exit(2)
  }
  try {
    const out = seed(profile, Date.now(), scale, showcase)
    for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(16)} ${v}`)
  } catch (err) {
    console.error(`shots-seed: ${err.message}`)
    process.exit(1)
  }
}
