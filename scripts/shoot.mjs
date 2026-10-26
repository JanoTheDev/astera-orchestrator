#!/usr/bin/env node
// Shoots the main screens of a running dev app over CDP: window sizes x themes, PNGs into one folder.
// No dependencies: Node 22+ built-in WebSocket and fetch. See docs/dev/CONTEXT.md ("Screenshots").
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Declared before USAGE, which lists the names; the steps only call helpers defined further down.
// Each page: how to reach it from a clean state (no editor tab, no popup). A step that returns false skips the page.
// Hooks are aria-labels, roles and class names the app has today (activity bar tabs, the side bar toolbar, the title bar
// project button, .ui-etab__close on editor tabs); a screen with no such hook gets a one-line data-shot attribute.
// A plan tab is ready once its Steps board is drawn
const PLAN_READY = "!!document.querySelector('.plan-page .plan-wave') && !/Loading|Scanning/.test(document.body.innerText)"
const PAGES = [
  ['sessions', () => activity('Agents')],
  ['plans', () => activity('Plans')],
  ['start', async () => (await activity('Plans'), await sleep(300), sleepClick('.wb-sidebar button', '^\\s*New plan\\s*$'))],
  ['mainplan', async () => (await activity('Plans'), await sleep(300), sleepClick('.wb-sidebar button', 'Open main plan'))],
  // ready: the scan is done and the tree holds a session row under its project row, not only the project and "Loading…"
  ['history', () => activity('History'), "document.querySelectorAll('.history-tree [role=treeitem]').length > 1 && !/Loading|Scanning/.test(document.body.innerText)"],
  ['explorer', () => activity('Explorer')],
  // --showcase: one click on the worktree row fills the Changes pane (it reads "Select a worktree" before)
  ['scm', async () => (await activity('Source Control'), await sleep(500), await sleepClick('.scm-tree [role=treeitem]'), true)],
  ['run', () => activity('Run')],
  ['devices', () => activity('Devices')],
  ['switcher', async () => (await activity('Agents'), await sleep(300), sleepClick('.tb-switcher'))],
  ['accounts', () => sleepClick('.wb-activitybar button[aria-label="Accounts"]')],
  ['settings', async () => (await sleepClick('.wb-activitybar button[aria-label="Manage"]')) && sleepClick('[role=menuitem]', '^\\s*Settings\\s*$')],
  // --showcase pages (docs/dev/shots/SEED.md, "Showcase seed"): the plan named by --plan, its Task named by --task
  // scrolled so the Steps board (Step 2 open, with its Tasks) fills the tab
  ['planboard', async () => (await openPlan()) && (await sleep(800), await scrollTo('document.getElementById("plan-steps")', 'start'), true), PLAN_READY],
  // the Plans tree with that plan's Steps and Tasks unfolded, next to its tab
  ['planstree', async () => (await openPlan()) && (await unfoldPlan(), true), PLAN_READY],
  // every project's cards ("All projects"), so the other projects' questions and approval show too
  ['needsyou', async () => (await openPlan()) && (await panelTab('^\\s*Needs you')) && (await sleepClick('.needs__bar [role=tab]', '^\\s*All projects\\s*$'), true), `${PLAN_READY} && !!document.querySelector('.wb-panel .needs')`],
  ['activity', async () => (await openPlan()) && panelTab('^\\s*Activity'), `${PLAN_READY} && !!document.querySelector('.wb-panel .act')`],
  // Attempts and the prompt show only in Advanced mode (ADVANCED below)
  ['taskdetail', async () => (await openPlan()) && (await sleep(800), sleepClick(`button.plan-card-title[aria-label=${JSON.stringify(`Show details of ${TASK}`)}]`) && (await sleep(500), await scrollTo("document.querySelector('.plan-card.selected')", 'start'), true)), `${PLAN_READY} && !!document.querySelector('.plan-card.selected .plan-row-detail')`],
  ['settings-agents', async () => (await openSettings()) && (await sleepClick('nav.settings-editor__toc [role=treeitem]', '^\\s*Agents\\s*$')) && (await evaluate(`document.querySelector('[data-anchor="roleModels"]')?.scrollIntoView({ block: 'start' }) ?? true`), true)],
  // Explorer with a file open in the editor: --file is a path under the open project, its folders unfolded on the way
  ['editor', () => openFile(FILE), "!!document.querySelector('.wb-editor .cm-editor')"]
]
const PAGE_NAMES = PAGES.map(([n]) => n)
/** Pages shot in Advanced mode; every other page is shot in the mode the app had when the run started. */
const ADVANCED = new Set(['taskdetail', 'settings-agents'])

const USAGE = `Usage: node scripts/shoot.mjs --port <cdp port> --out <dir> [--sizes 1440x900,1024x640] [--themes night,day] [--pages <names>]
       [--plan <name>] [--task <title>] [--file <path>]

Connects to a dev app started with
  ASTERA_PROFILE_DIR=~/.config/astera-dev npx electron-vite dev --remoteDebuggingPort <port>
and writes <dir>/<page>-<WxH>-<theme>.png for every page. Also: npm run shots -- --port <p> --out <dir>
Pages (default: all): ${PAGE_NAMES.join(', ')}. Plan shots: --sizes 1920x1080,1000x800 --pages start,sessions,history,switcher,mainplan
(docs/dev/shots/SEED.md, "Plan shots"). The planboard, planstree, needsyou, activity and taskdetail pages open the plan
--plan <name> (default "Checkout redesign") and the Task --task <title> (default "Show delivery estimates under each
address"); editor opens --file <path> (default src/cart/CartSummary.tsx). Seed them with shots-seed.mjs --showcase
(docs/dev/shots/SEED.md, "Showcase seed").`

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE)
  process.exit(0)
}
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const port = Number(opt('port'))
const outOpt = opt('out')
if (!port || !outOpt) {
  console.error(USAGE)
  process.exit(2)
}
const out = resolve(outOpt)
const sizes = opt('sizes', '1440x900,1024x640').split(',').map((s) => s.split('x').map(Number))
const themes = opt('themes', 'night,day').split(',') // ids as in Settings: night, dusk, day
const PLAN = opt('plan', 'Checkout redesign')
const TASK = opt('task', 'Show delivery estimates under each address')
const FILE = opt('file', 'src/cart/CartSummary.tsx')
mkdirSync(out, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const target = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!target) throw new Error(`no page target on port ${port}`)
const ws = new WebSocket(target.webSocketDebuggerUrl)
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
const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value

const CTRL = 2
async function chord(key, code, vk, modifiers = CTRL) {
  const base = { key, code, windowsVirtualKeyCode: vk, modifiers }
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}
const escape = () => chord('Escape', 'Escape', 27, 0)

/** Real mouse click on the first element matching `selector` whose text or aria-label matches `text` (if given);
 *  `deepest` takes the last match instead, i.e. the innermost element when matches nest. */
async function click(selector, text, deepest = false) {
  const pt = await evaluate(`(() => {
    const re = ${text ? `new RegExp(${JSON.stringify(text)}, 'i')` : 'null'}
    const hits = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getClientRects().length && (!re || re.test((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || ''))))
    const el = ${deepest ? 'hits.at(-1)' : 'hits[0]'}
    if (!el) return null
    el.scrollIntoView({ block: 'nearest' }) // a page reopened scrolled away (Settings) keeps the target off screen
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

/** Opens an activity bar view. Clicking the active one collapses the side bar, so an active one is left alone
 *  (and a collapsed bar is reopened by one click). */
async function activity(label) {
  const sel = `.wb-activitybar [role=tab][aria-label^="${label}"]`
  const open = await evaluate(`document.querySelector(${JSON.stringify(sel)})?.getAttribute('aria-selected') === 'true'`)
  if (open) return true
  return click(sel)
}
const sleepClick = async (...a) => ((await click(...a)) ? (await sleep(500), true) : false)
/** Clicks the element the page-side expression `expr` returns (marked for `click`), false when it returns none. */
async function clickEl(expr) {
  const found = await evaluate(`(() => {
    document.querySelectorAll('[data-shoot-hit]').forEach((e) => e.removeAttribute('data-shoot-hit'))
    const el = ${expr}
    el?.setAttribute('data-shoot-hit', '')
    return !!el
  })()`)
  return found && sleepClick('[data-shoot-hit]')
}
/** Scrolls the element the page-side expression `expr` returns into view (false when it returns none). */
const scrollTo = (expr, block) => evaluate(`(() => { const el = ${expr}; el?.scrollIntoView({ block: '${block}' }); return !!el })()`)
/** Opens --plan's tab from the Plans side bar (one click on its row). */
async function openPlan() {
  await activity('Plans')
  await sleep(500)
  return clickEl(`[...document.querySelectorAll('.plans-tree [role=treeitem][aria-level="1"]')].find((e) => e.querySelector('.ui-tree__label')?.textContent.trim() === ${JSON.stringify(PLAN)})`)
}
/** Unfolds --plan's row in the Plans tree, then each of its Steps (a click on an open row's twistie would fold it). */
async function unfoldPlan() {
  const next = (level) => `(() => {
    const rows = [...document.querySelectorAll('.plans-tree [role=treeitem]')]
    const at = rows.findIndex((e) => e.getAttribute('aria-level') === '1' && e.querySelector('.ui-tree__label')?.textContent.trim() === ${JSON.stringify(PLAN)})
    if (at < 0) return null
    const own = [rows[at]]
    for (const e of rows.slice(at + 1)) {
      if (e.getAttribute('aria-level') === '1') break
      own.push(e)
    }
    return own.find((e) => e.getAttribute('aria-level') === '${level}' && e.getAttribute('aria-expanded') === 'false')?.querySelector('.ui-tree__twistie') ?? null
  })()`
  await clickEl(next(1))
  for (let i = 0; i < 6 && (await clickEl(next(2))); i++) await sleep(200)
}
/** Opens the bottom panel (Ctrl+J, with no terminal focused) on the tab whose label matches `label`. */
async function panelTab(label) {
  await evaluate('document.activeElement?.blur()')
  if (!(await evaluate("!!document.querySelector('section.wb-panel')"))) await chord('j', 'KeyJ', 74)
  await sleep(500)
  return sleepClick('section.wb-panel [role=tablist] [role=tab]', label)
}
const openSettings = async () => (await sleepClick('.wb-activitybar button[aria-label="Manage"]')) && (await sleepClick('[role=menuitem]', '^\\s*Settings\\s*$')) && (await sleep(500), true)
/** Advanced mode as the app keeps it (useAdvancedMode.ts mirrors it to localStorage); switched through Settings. */
const advancedOn = () => evaluate("localStorage.getItem('cm.advancedMode') === '1'")
async function setAdvanced(on) {
  if ((await advancedOn()) === on) return
  await reset()
  await openSettings()
  await click('.settings-editor__advanced input[role=switch]')
  await sleep(500)
  if ((await advancedOn()) !== on) throw new Error(`Advanced mode not ${on ? 'on' : 'off'}`)
  await reset()
}
/** Explorer, each folder of `file` unfolded (a click on an open one would fold it), then the file opened. */
async function openFile(file) {
  await activity('Explorer')
  await sleep(500)
  const parts = file.split('/')
  for (const dir of parts.slice(0, -1)) {
    const row = `[...document.querySelectorAll('.wb-sidebar .fx-row:not(.file)')].find((e) => e.querySelector('.fx-name')?.textContent === ${JSON.stringify(dir)})`
    if (await evaluate(`!!${row}?.querySelector('.ui-tree__twistie.is-open')`)) continue
    if (!(await clickEl(row))) return false
    await sleep(500)
  }
  return clickEl(`[...document.querySelectorAll('.wb-sidebar .fx-row.file')].find((e) => e.querySelector('.fx-name')?.textContent === ${JSON.stringify(parts.at(-1))})`)
}
const only = opt('pages', '').split(',').filter(Boolean)
const unknown = only.filter((n) => !PAGE_NAMES.includes(n))
if (unknown.length) {
  console.error(`unknown page(s) ${unknown.join(', ')}; pages: ${PAGE_NAMES.join(', ')}`)
  process.exit(2)
}
const pages = PAGES.filter(([n]) => only.length === 0 || only.includes(n))

/** Back to a clean state: popups and menus closed, every editor tab closed (they pile up: Start, Main plan, Settings),
 *  except session tabs: closing one ends its agent session, and a profile with live sessions is shot as it runs. */
async function reset() {
  // Escape typed into a focused agent terminal interrupts that agent: let go of focus first (menus close on the page)
  await evaluate('document.activeElement?.blur()')
  await escape()
  await escape()
  for (let i = 0; i < 12 && (await click('.wb-editor .ui-etab:not([data-tab-id^="session:"]) .ui-etab__close')); i++) await sleep(150)
  // the bottom panel (Needs you, Activity) closes too: Ctrl+J toggles it, and the blur above keeps a terminal from eating it
  if (await evaluate("!!document.querySelector('section.wb-panel')")) await chord('j', 'KeyJ', 74)
  await evaluate('document.activeElement?.blur()') // no stale focus ring from the previous step
  await sleep(200)
}

let count = 0
const initialAdvanced = await advancedOn()
const initialTheme = await evaluate('document.documentElement.dataset.theme')
// The theme lives in the app's settings (the localStorage mirror alone is overwritten on load): pick its card.
async function setTheme(id) {
  await reset()
  await sleepClick('.wb-activitybar button[aria-label="Manage"]')
  await sleepClick('[role=menuitem]', '^\\s*Settings\\s*$')
  await sleep(700)
  await click('*', `^${id}\\s*$`, true)
  await sleep(700)
  const shown = await evaluate('document.documentElement.dataset.theme')
  if (shown !== id) throw new Error(`theme ${id} not applied (page shows ${shown})`)
  await reset() // Settings is an editor tab now
}
for (const theme of themes) {
  await setTheme(theme)
  for (const [w, h] of sizes) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    for (const [name, go, ready] of pages) {
      await setAdvanced(ADVANCED.has(name) || initialAdvanced)
      await reset()
      const ok = await go()
      await sleep(1100) // overlays fade in; a shot taken mid-fade is washed out
      if (ok === false) {
        console.warn(`skip ${name} (${w}x${h} ${theme}): not reachable`)
        continue
      }
      // History scans on open and can take seconds: never save a shot taken mid-load
      const until = ready ?? '!/Loading|Scanning/.test(document.body.innerText)'
      let loaded = false
      for (let i = 0; i < 60 && !(loaded = await evaluate(until)); i++) await sleep(500)
      if (!loaded) {
        console.warn(`skip ${name} (${w}x${h} ${theme}): still loading after 30 s`)
        continue
      }
      await sleep(300)
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' })
      const file = `${name}-${w}x${h}-${theme}.png`
      writeFileSync(join(out, file), Buffer.from(data, 'base64'))
      console.log(file)
      count++
    }
    await reset()
  }
}
await setAdvanced(initialAdvanced)
await cdp('Emulation.clearDeviceMetricsOverride')
if (initialTheme !== themes.at(-1)) await setTheme(initialTheme)
console.log(`${count} screenshots in ${out}`)
ws.close()
