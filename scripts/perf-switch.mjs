#!/usr/bin/env node
// Measures how long Astera takes to switch views, tabs and projects, over CDP (docs/perf/README.md).
// No dependencies: Node 22+ built-in WebSocket and fetch, the same raw CDP as scripts/shoot.mjs.
// Never point it at the owner's real profile: it opens plans, switches projects and renames one seeded plan.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const USAGE = `Usage: node scripts/perf-switch.mjs --port <cdp port> [--runs 5] [--warmup 1] [--tabs 8] [--out file.json]
                               [--only <targets>] [--profile <dir>] [--md file.md] [--sessions N] [--cpu]

Connects to an app started on a profile seeded with \`node scripts/shots-seed.mjs --scale\` and a CDP port
(docs/perf/README.md has the exact commands). For every target it does --warmup unrecorded runs, then --runs runs from a
settled other view, and records, measured in the page with performance.now():
  ttfp     click to the end of the frame after it (pointerdown, then two requestAnimationFrame)
  settled  click until the target's ready predicate is true and the DOM has not mutated for 300 ms, minus the 300 ms
  long     long frames (long-animation-frame, else longtask) between the click and "settled": count and longest, in ms
  lcw      last click wins: click A, 30 ms later click B; once the DOM is quiet the visible selection must be B.
           Run plain, and with a state push (an orch command renamed a plan, fired right after A).
Targets (default: all): ${'${TARGETS}'}
--profile is the seeded profile folder (default ~/.config/astera-perf-dev), used for the state push's project path.
--sessions N opens N sessions (window.api.sessions.spawn on the seeded account, kind terminal) in the shown project before
measuring and closes them afterwards. The Host starts whatever \`claude\` its PATH finds first: see docs/perf/README.md.
content  (Sessions, Run, Source Control, Devices only) click until the visible sidebar view has drawn its rows or empty state
         and no "Loading"/"Scanning" is left. A separate column: "settled" for those four stays the unchanged predicate.
--cpu records a V8 CPU profile around each timed run and keeps, for every run with a long frame, the top self-time
functions (name, bundle url:line:col) plus the long frames' script attribution; diagnosis only, the profiler slows the page.
--out writes the raw JSON; a markdown table is printed to stdout (--md also saves it).`

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- targets ----------------------------------------------------------------------------------------------------
// A target: `setup(i)` leaves the app settled on the start state, `act(i)` is the timed real click, `ready(i)` is the page
// predicate for "settled", `lcw` is the last-click-wins variant (`a` the first click, `check` true when B is what shows).
// the visible child of the sidebar body is the active view (the others stay mounted, display: none)
const sideView = `[...document.querySelectorAll('.wb-sidebar__body > *')].find((c) => c.getClientRects().length)`
const contentDrawn = (rows = 0) => `(() => { const v = ${sideView}; return !!v && v.textContent.trim().length > 0 && !/Loading|Scanning/.test(v.textContent) && v.querySelectorAll('.ui-tree__row').length >= ${rows} })()`
const VIEWS = [
  ['Plans', 'Plans', 'document.querySelectorAll(".wb-sidebar .ui-tree__row").length > 0'],
  ['Sessions', 'Agents', 'true'],
  ['History', 'History', 'document.querySelectorAll(".history-tree [role=treeitem]").length > 1 && !/Loading|Scanning/.test(document.querySelector(".history-tree").textContent)'],
  ['Run', 'Run', 'true'],
  ['Source Control', 'Source Control', 'true'],
  ['Devices', 'Devices', 'true']
]
const TARGET_NAMES = [...VIEWS.map(([n]) => n), 'Settings', 'Tab switch', 'Project switch', 'Open plan', 'Main plan', 'New plan']
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE.replace('${TARGETS}', TARGET_NAMES.join(', ')))
  process.exit(0)
}
const port = Number(opt('port'))
if (!port) {
  console.error(USAGE.replace('${TARGETS}', TARGET_NAMES.join(', ')))
  process.exit(2)
}
const runs = Number(opt('runs', 5))
const warmup = Number(opt('warmup', 1))
const cpuProfile = args.includes('--cpu')
const sessionCount = Number(opt('sessions', 0))
const tabCount = Math.max(3, Number(opt('tabs', 8)))
const profile = resolve(opt('profile', join(homedir(), '.config', 'astera-perf-dev')))
const only = opt('only', '').split(',').filter(Boolean)
const unknown = only.filter((n) => !TARGET_NAMES.includes(n))
if (unknown.length) {
  console.error(`unknown target(s) ${unknown.join(', ')}; targets: ${TARGET_NAMES.join(', ')}`)
  process.exit(2)
}

// ---- CDP --------------------------------------------------------------------------------------------------------
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!page) throw new Error(`no page target on port ${port}`)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('CDP websocket failed'))
})
let nextId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`))
  else p.res(m.result)
}
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++nextId
    pending.set(id, { res, rej, method })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}

/** Real mouse click on the first visible element matching `selector` whose text or aria-label matches `text`. */
async function click(selector, text) {
  const pt = await evaluate(`(() => {
    const re = ${text ? `new RegExp(${JSON.stringify(text)}, 'i')` : 'null'}
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.getClientRects().length && (!re || re.test((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || ''))))
    if (!el) return null
    el.scrollIntoView({ block: 'nearest' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  if (!pt) return false
  const m = { x: pt.x, y: pt.y, button: 'left', clickCount: 1 }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...m })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...m })
  return true
}
const must = async (...a) => {
  if (!(await click(...a))) throw new Error(`nothing to click for ${a.join(' / ')}`)
}

// ---- in the page ------------------------------------------------------------------------------------------------
// One switch: `arm` before the click, the page's own pointerdown starts the clock, `finish` after the click.
const HARNESS = `(() => {
  const longType = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame') ? 'long-animation-frame' : 'longtask'
  let st = null
  const loaf = (e) => ({
    start: e.startTime,
    dur: e.duration,
    blocking: Math.round(e.blockingDuration),
    render: e.renderStart ? Math.round(e.startTime + e.duration - e.renderStart) : null,
    scripts: (e.scripts || []).map((x) => ({ invoker: x.invoker, type: x.invokerType, fn: x.sourceFunctionName, url: (x.sourceURL || '').split('/').pop(), pos: x.sourceCharPosition, dur: Math.round(x.duration), layout: Math.round(x.forcedStyleAndLayoutDuration) }))
  })
  const disarm = () => {
    if (!st) return
    st.mo.disconnect()
    st.po.disconnect()
    removeEventListener('pointerdown', st.down, true)
    st = null
  }
  window.__perf = {
    longType,
    arm(readySrc, contentSrc) {
      disarm()
      const s = (st = { t0: null, tPaint: null, lastMut: performance.now(), readyAt: null, contentAt: null, long: [], downs: [], mutatedByPaint: false })
      s.ready = new Function('return (' + readySrc + ')')
      s.content = contentSrc ? new Function('return (' + contentSrc + ')') : null
      const check = () => {
        let ok = false
        try { ok = !!s.ready() } catch {}
        if (!ok) s.readyAt = null
        else if (s.readyAt == null) s.readyAt = performance.now()
        if (s.content) {
          let c = false
          try { c = !!s.content() } catch {}
          if (!c) s.contentAt = null
          else if (s.contentAt == null) s.contentAt = performance.now()
        }
      }
      s.mo = new MutationObserver(() => {
        s.lastMut = performance.now()
        if (s.t0 != null && s.tPaint == null) s.mutatedByPaint = true
        if (s.t0 != null) check()
      })
      s.mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
      s.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) s.long.push(loaf(e)) })
      s.po.observe({ type: longType })
      s.down = (e) => {
        // every pointerdown: where it landed and what the title bar and switcher showed at that moment
        const el = e.target instanceof Element ? e.target : null
        s.downs.push({ at: Math.round(e.timeStamp), target: el ? (el.closest('[class]')?.className ?? el.tagName).toString().slice(0, 60) + ' | ' + (el.textContent || '').trim().slice(0, 30) : null, title: document.querySelector('.tb-switcher-name')?.textContent ?? null, popup: !!document.querySelector('.tb-sw-pop') })
        if (s.t0 != null) return
        s.t0 = e.timeStamp
        requestAnimationFrame(() => requestAnimationFrame(() => { s.tPaint = performance.now() }))
      }
      addEventListener('pointerdown', s.down, true)
      s.check = check
    },
    // the DOM stays unchanged for quietMs (and, if given, the page has run at least minMs since the click)
    async finish(quietMs, timeoutMs, minMs) {
      const s = st
      const began = performance.now()
      for (;;) {
        await new Promise((r) => setTimeout(r, 10))
        const now = performance.now()
        if (s.t0 == null) { if (now - began > 3000) { disarm(); return { error: 'no click reached the page' } } continue }
        s.check()
        const quiet = s.tPaint != null && s.readyAt != null && now - Math.max(s.lastMut, s.readyAt) >= quietMs && now - s.t0 >= minMs
        const timedOut = now - s.t0 > timeoutMs
        if (!quiet && !timedOut) continue
        await new Promise((r) => setTimeout(r, 120)) // long-animation-frame entries arrive after their frame
        for (const e of s.po.takeRecords()) s.long.push(loaf(e))
        const settledAt = timedOut && !quiet ? null : Math.max(s.lastMut, s.readyAt ?? 0)
        const end = settledAt ?? s.t0 + timeoutMs
        const frames = s.long.filter((e) => e.start + e.dur >= s.t0 && e.start <= end)
        const long = frames.map((e) => Math.round(e.dur * 10) / 10)
        const out = {
          ttfp: s.tPaint == null ? null : Math.max(0, s.tPaint - s.t0),
          settled: settledAt == null ? null : Math.max(0, settledAt - s.t0, s.tPaint == null ? 0 : s.tPaint - s.t0), // never before the first paint
          changedByPaint: s.mutatedByPaint,
          longCount: long.length,
          longMax: long.length ? Math.max(...long) : 0,
          long,
          frames,
          timedOut: settledAt == null,
          content: s.content ? (s.contentAt == null ? null : Math.max(0, s.contentAt - s.t0, s.tPaint == null ? 0 : s.tPaint - s.t0)) : undefined,
          downs: s.downs
        }
        disarm()
        return out
      }
    },
    // resolves once nothing has mutated for quietMs
    quiet(quietMs, timeoutMs) {
      return new Promise((res) => {
        let last = performance.now()
        const mo = new MutationObserver(() => { last = performance.now() })
        mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
        const began = last
        const t = setInterval(() => {
          const now = performance.now()
          if (now - last >= quietMs || now - began > timeoutMs) { clearInterval(t); mo.disconnect(); res(now - last >= quietMs) }
        }, 20)
      })
    }
  }
})()`
// a covered or minimised window stops requestAnimationFrame, so the first-paint clock would never end
const settle = async () => (await cdp('Page.bringToFront'), evaluate('__perf.quiet(400, 10000)'))

// ---- navigating the app -----------------------------------------------------------------------------------------
const ACT = (label) => `.wb-activitybar [role=tab][aria-label^="${label}"]`
const activeView = (label) => `document.querySelector(${JSON.stringify(ACT(label))})?.getAttribute('aria-selected') === 'true'`
const activeTab = `document.querySelector('.wb-editor .ui-etab.is-active')?.dataset.tabId`
const editorDrawn = `(document.querySelector('.wb-editor')?.textContent.length ?? 0) > 100 && !/Loading|Scanning/.test(document.querySelector('.wb-editor').textContent)`
const tabReady = (id) => `${activeTab} === ${JSON.stringify(id)} && ${editorDrawn}`
const tabSel = (id) => `.wb-editor .ui-etab[data-tab-id="${id}"]`

async function activity(label) {
  if (await evaluate(activeView(label))) return
  await must(ACT(label))
}
/** Popups closed, every editor tab closed: back to the state each run starts from. */
async function reset() {
  await evaluate('document.activeElement?.blur()')
  for (const k of ['Escape', 'Escape']) {
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: 27 })
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: 27 })
  }
  for (let i = 0; i < 40 && (await click('.wb-editor .ui-etab:not([data-tab-id^="session:"]) .ui-etab__close')); i++) await sleep(120)
  await evaluate('document.activeElement?.blur()')
}
const planRows = () => evaluate(`[...document.querySelectorAll('.wb-sidebar .ui-tree__row')].map((r) => r.querySelector('.ui-tree__label')?.textContent.trim()).filter((t) => /^Plan \\d+/.test(t))`)
const planRow = (title) => click('.wb-sidebar .ui-tree__row', `^\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
const planTabId = async (title) => evaluate(`[...document.querySelectorAll('.wb-editor .ui-etab')].find((e) => e.textContent.includes(${JSON.stringify(title)}))?.dataset.tabId`)

let planTitles = []
let openTabIds = [] // tab switch: the plan tabs it opened
const push = { n: 0, repo: join(profile, 'shots-seed', 'demo-app'), job: 'job_5eed000000000001', title: 'Settings page', ok: 0, failed: 0 }
/** A cheap orch command that changes state (renames a seeded plan), fired without waiting: the Host answers with a state push. */
const pushState = () => {
  const title = ++push.n % 2 ? `${push.title} (perf)` : push.title
  return evaluate(`void window.api.orch.command(${JSON.stringify(push.repo)}, 'jobs-rename', { id: ${JSON.stringify(push.job)}, title: ${JSON.stringify(title)} }).then((r) => { window.__push = r })`)
}

const other = (...used) => ['Source Control', 'Devices', 'Run', 'History'].find((v) => !used.includes(v))
const defs = []
const CONTENT_VIEWS = ['Sessions', 'Run', 'Source Control', 'Devices']
for (const [name, label, extra] of VIEWS) {
  const from = label === 'Agents' ? 'Plans' : 'Agents'
  const a = other(label, from)
  defs.push({
    name,
    setup: async () => (await reset(), await activity(from)),
    act: () => must(ACT(label)),
    ready: () => `${activeView(label)} && (${extra})`,
    content: CONTENT_VIEWS.includes(name) ? () => `${activeView(label)} && ${contentDrawn(name === 'Sessions' ? sessionCount : 0)}` : undefined,
    lcw: { a: () => must(ACT(a)), check: () => `${activeView(label)}`, setup: async () => (await reset(), await activity(from)) }
  })
}
defs.push({
  name: 'Settings',
  setup: async () => (await reset(), await activity('Agents'), await settle(), await must('.wb-activitybar button[aria-label="Manage"]'), await sleep(400)),
  act: () => must('[role=menuitem]', '^\\s*Settings\\s*$'),
  ready: () => tabReady('view:settings'),
  // the Settings item is the first click here, B is the Plans view
  lcw: { a: () => must('[role=menuitem]', '^\\s*Settings\\s*$'), b: () => must(ACT('Plans')), check: () => activeView('Plans') }
})
defs.push({
  name: 'Tab switch',
  setup: async (i, lcw) => {
    if (!openTabIds.length) {
      await reset()
      await activity('Plans')
      await settle()
      planTitles = await planRows()
      for (const t of planTitles.slice(0, tabCount)) {
        await must('.wb-sidebar .ui-tree__row', `^\\s*${t}`)
        await sleep(250)
        openTabIds.push(await planTabId(t))
      }
      openTabIds = openTabIds.filter(Boolean)
      if (openTabIds.length < 3) throw new Error(`tab switch needs 3 plan tabs, opened ${openTabIds.length}`)
    }
    // B alternates between the first two tabs; start from the other one
    const [t1, t2] = openTabIds
    const b = i % 2 ? t2 : t1
    await must(tabSel(b === t1 ? t2 : t1))
    await settle()
  },
  act: (i) => must(tabSel(openTabIds[i % 2 ? 1 : 0])),
  ready: (i) => tabReady(openTabIds[i % 2 ? 1 : 0]),
  lcw: { a: () => must(tabSel(openTabIds[2])), check: (i) => `${activeTab} === ${JSON.stringify(openTabIds[i % 2 ? 1 : 0])}` }
})
let projectTarget = 'api-server'
defs.push({
  name: 'Project switch',
  setup: async () => {
    await reset()
    await activity('Plans')
    await settle()
    const current = await evaluate(`document.querySelector('.tb-switcher-name')?.textContent`)
    projectTarget = current === 'demo-app' ? 'api-server' : 'demo-app'
    await must('.tb-switcher')
    await sleep(500)
  },
  act: () => must('.tb-sw-main', `^\\s*${projectTarget}`),
  ready: () => `document.querySelector('.tb-switcher-name')?.textContent === ${JSON.stringify(projectTarget)} && !document.querySelector('.tb-sw-pop') && document.querySelectorAll('.wb-sidebar .ui-tree__row').length > 0 && !/Loading/.test(document.querySelector('.wb-sidebar').textContent)`,
  // another project first; the popup may close on that click, then B has nothing to click (recorded as not run)
  lcw: { a: () => must('.tb-sw-main', '^\\s*acme'), check: () => `document.querySelector('.tb-switcher-name')?.textContent === ${JSON.stringify(projectTarget)}` }
})
const planSetup = async () => (await reset(), await activity('Plans'), await settle(), (planTitles = await planRows()))
defs.push({
  name: 'Open plan',
  setup: planSetup,
  act: (i) => must('.wb-sidebar .ui-tree__row', `^\\s*${planTitles[i % planTitles.length]}`),
  ready: (i) => `${activeTab}?.startsWith('view:plan:') && ${editorDrawn} && document.querySelector('.wb-editor').textContent.includes(${JSON.stringify(planTitles[i % planTitles.length])})`,
  lcw: { a: () => must('.wb-sidebar .ui-tree__row', `^\\s*${planTitles[0]}`), check: (i) => `document.querySelector('.wb-editor .ui-etab.is-active')?.textContent.includes(${JSON.stringify(planTitles[1 + (i % (planTitles.length - 1))])})`, bi: (i) => planTitles[1 + (i % (planTitles.length - 1))] }
})
defs.push({
  name: 'Main plan',
  setup: planSetup,
  act: () => must('.wb-sidebar button', 'Open main plan'),
  ready: () => tabReady('view:mainplan'),
  lcw: { a: () => must('.wb-sidebar button[aria-label="New plan"]'), check: () => `${activeTab} === 'view:mainplan'` }
})
defs.push({
  name: 'New plan',
  setup: planSetup,
  act: () => must('.wb-sidebar button[aria-label="New plan"]'),
  ready: () => `${activeTab} === 'view:start' && ${editorDrawn}`,
  lcw: { a: () => must('.wb-sidebar button', 'Open main plan'), check: () => `${activeTab} === 'view:start'` }
})
// Open plan's last-click-wins B is a different plan each run, so its `act` must follow `bi`
defs.find((d) => d.name === 'Open plan').lcw.b = (i) => must('.wb-sidebar .ui-tree__row', `^\\s*${planTitles[1 + (i % (planTitles.length - 1))]}`)

// ---- running ---------------------------------------------------------------------------------------------------
const stat = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b)
  if (!v.length) return { median: null, p95: null }
  const at = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)]
  return { median: v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2, p95: at(0.95) }
}
const r1 = (x) => (x == null ? 'n/a' : (Math.round(x * 10) / 10).toString())

/** Self time per function from a V8 profile, biggest first: where the main thread spent the switch. */
function topSelf(profile, n = 12) {
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]))
  const self = new Map()
  profile.samples.forEach((id, k) => {
    const cf = byId.get(id).callFrame
    const key = `${cf.functionName || '(anonymous)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[k] ?? 0))
  })
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([fn, us]) => ({ fn, ms: Math.round(us / 100) / 10 }))
}
async function timed(def, i) {
  await def.setup(i)
  await settle()
  await evaluate(`__perf.arm(${JSON.stringify(def.ready(i))}, ${JSON.stringify(def.content?.(i) ?? null)})`)
  if (cpuProfile) await cdp('Profiler.start')
  await def.act(i)
  const r = await evaluate('__perf.finish(300, 15000, 0)')
  if (cpuProfile) r.cpu = topSelf((await cdp('Profiler.stop')).profile)
  if (r.error) throw new Error(`${def.name}: ${r.error}`)
  return r
}
async function lastClick(def, i, withPush) {
  await (def.lcw.setup ?? def.setup)(i, true)
  await settle()
  await evaluate(`window.__push = undefined; __perf.arm('true')`)
  try {
    await def.lcw.a(i)
  } catch {
    await evaluate('__perf.finish(100, 1000, 0)').catch(() => {})
    return { skipped: 'A has nothing to click' }
  }
  if (withPush) await pushState()
  await sleep(30)
  try {
    await (def.lcw.b ?? def.act)(i)
  } catch {
    await evaluate('__perf.finish(100, 1000, 0)').catch(() => {})
    return { skipped: 'the first click removed B (a popup that closes on select)' }
  }
  const r = await evaluate('__perf.finish(400, 15000, 800)')
  const pass = await evaluate(def.lcw.check(i))
  if (withPush) {
    await sleep(300)
    const res = await evaluate('window.__push ?? null')
    if (res && res.ok !== false) push.ok++
    else push.failed++
  }
  return { pass: !!pass, settled: r.settled, downs: r.downs, project: await evaluate(`document.querySelector('.tb-switcher-name')?.textContent`) }
}

await evaluate(HARNESS)
if (cpuProfile) {
  await cdp('Profiler.enable')
  await cdp('Profiler.setSamplingInterval', { interval: 200 })
}
const shown = await evaluate(`document.querySelector('.tb-switcher-name')?.textContent`)
if (!['demo-app', 'api-server', 'acme', 'web', 'mobile-app'].includes(shown)) {
  console.error(`refusing: the app shows project "${shown}", not a profile seeded by shots-seed.mjs --scale`)
  process.exit(1)
}
const sessionIds = []
if (sessionCount) {
  // the sessions go to the shown project, so the Agents view lists them
  const cwd = join(profile, 'shots-seed', shown)
  for (let i = 0; i < sessionCount; i++) sessionIds.push(await evaluate(`window.api.sessions.spawn({ accountId: 'shots-seed', cwd: ${JSON.stringify(cwd)}, kind: 'terminal' }).then((s) => s.id)`))
  await sleep(2000)
}
await reset()
const results = {}
const todo = defs.filter((d) => only.length === 0 || only.includes(d.name))
for (const def of todo) {
  const rec = { runs: [], lcw: [], lcwPush: [] }
  console.error(`# ${def.name}`)
  for (let i = 0; i < warmup + runs; i++) {
    const r = await timed(def, i)
    if (i >= warmup) rec.runs.push(r)
  }
  for (let i = 0; i < runs; i++) rec.lcw.push(await lastClick(def, i, false))
  for (let i = 0; i < runs; i++) rec.lcwPush.push(await lastClick(def, i, true))
  results[def.name] = rec
}
for (const id of sessionIds) await evaluate(`window.api.sessions.kill(${JSON.stringify(id)})`).catch(() => {})
await reset()
await pushState().catch(() => {}) // leave the seeded title as it was (an odd count of pushes renamed it)
if (push.n % 2) await pushState().catch(() => {})
await sleep(500)

// ---- report -----------------------------------------------------------------------------------------------------
const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}
const cpu = (readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.+)/) ?? [])[1] ?? 'unknown'
const view = await evaluate(`({ w: innerWidth, h: innerHeight, ua: navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0] })`)
const longType = await evaluate('__perf.longType')
const rate = (xs) => {
  const ran = xs.filter((x) => !x.skipped)
  return ran.length ? `${ran.filter((x) => x.pass).length}/${ran.length}` : 'n/a'
}
const summary = Object.fromEntries(
  Object.entries(results).map(([name, rec]) => [
    name,
    {
      ttfp: stat(rec.runs.map((r) => r.ttfp)),
      settled: stat(rec.runs.map((r) => r.settled)),
      longMax: Math.max(0, ...rec.runs.map((r) => r.longMax)),
      longFrames: rec.runs.reduce((n, r) => n + r.longCount, 0),
      content: rec.runs.some((r) => r.content !== undefined) ? stat(rec.runs.map((r) => r.content)) : undefined,
      timedOut: rec.runs.filter((r) => r.timedOut).length,
      lcw: rate(rec.lcw),
      lcwPush: rate(rec.lcwPush)
    }
  ])
)
const meta = {
  date: new Date().toISOString(),
  commit: git('rev-parse', '--short', 'HEAD'),
  cpu,
  cpus: (readFileSync('/proc/cpuinfo', 'utf8').match(/^processor/gm) ?? []).length,
  chrome: view.ua,
  viewport: `${view.w}x${view.h}`,
  longFrameEntry: longType,
  runs,
  warmup,
  tabs: openTabIds.length,
  sessions: sessionCount,
  statePush: { fired: push.n, answered: push.ok, failed: push.failed }
}
const rows = Object.entries(summary).map(
  ([n, s]) => `| ${n} | ${r1(s.ttfp.median)} | ${r1(s.ttfp.p95)} | ${r1(s.settled.median)} | ${r1(s.settled.p95)} | ${r1(s.longMax)} (${s.longFrames}) | ${s.lcw} | ${s.lcwPush} |${s.timedOut ? ` ${s.timedOut} run(s) never settled` : ''}`
)
const md = [
  '| Target | First paint median (ms) | p95 | Settled median (ms) | p95 | Longest frame ms (count) | Last click wins | Last click wins + state push |',
  '|---|---|---|---|---|---|---|---|',
  ...rows
].join('\n')
const withContent = Object.entries(summary).filter(([, s]) => s.content)
const contentMd = withContent.length
  ? ['', '| Target (content ready) | Median (ms) | p95 |', '|---|---|---|', ...withContent.map(([n, s]) => `| ${n} | ${r1(s.content.median)} | ${r1(s.content.p95)} |`)].join('\n')
  : ''
if (opt('out')) writeFileSync(resolve(opt('out')), JSON.stringify({ meta, summary, results }, null, 2) + '\n')
if (opt('md')) writeFileSync(resolve(opt('md')), md + contentMd + '\n')
console.log(md + contentMd)
ws.close()
