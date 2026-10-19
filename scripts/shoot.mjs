#!/usr/bin/env node
// Shoots every page of a running dev app over CDP: two window sizes x two themes, PNGs into one folder.
// No dependencies: Node 22+ built-in WebSocket and fetch. See docs/dev/CONTEXT.md ("Screenshots").
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const USAGE = `Usage: node scripts/shoot.mjs --port <cdp port> --out <dir> [--sizes 1440x900,1024x640] [--themes night,day]

Connects to a dev app started with
  ASTERA_PROFILE_DIR=~/.config/astera-dev npx electron-vite dev --remoteDebuggingPort <port>
and writes <dir>/<size>-<theme>-<NN>-<page>.png for every page. Also: npm run shots -- --port <p> --out <dir>`

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

// The New button, not Ctrl+N: a focused console keeps Ctrl+N on Linux (readline), so the chord misses over a session.
const openNew = () => click('.tb-main button', '^\\s*New\\s*$')
const digit = (n) => () => chord(String(n), `Digit${n}`, 48 + n)
// Each page: how to reach it from a clean (overlay-free) state. A step that returns false skips the page.
// DIFFERS: the page needs a project or a plan the dev profile may not have; its click then changes nothing, so a shot
// identical to the page it starts from is dropped instead of saved under a false name.
const DIFFERS = { start: 'agents', plan: 'plans' }
const PAGES = [
  ['agents', digit(1)],
  [
    'start',
    async () => {
      await openNew()
      await sleep(400)
      const ok = await click('[role=dialog] *', 'plan it for me', true)
      // Opening Start leaves the New modal up; one Escape closes only that.
      if (ok) {
        await sleep(1500)
        await escape()
      }
      return ok
    }
  ],
  ['tasks', digit(2)],
  ['plans', digit(3)],
  ['plan', async () => (await digit(3)(), await sleep(400), click('main a, main button, main [role=button], main li, main tr', '.')) && (await sleep(500), true)],
  ['inbox', digit(4)],
  ['worktrees', digit(5)],
  ['files', digit(6)],
  ['settings', () => click('button[aria-label]', 'settings|설정')],
  ['new-menu', async () => (await digit(1)(), await sleep(300), openNew())],
  ['project-switcher', () => click('.tb-switcher')],
  ['accounts', () => click('.tb-usage-btn')]
]

const pad = (n) => String(n).padStart(2, '0')
let count = 0
let shots = {}
const initialTheme = await evaluate('document.documentElement.dataset.theme')
// The theme lives in the app's settings (the localStorage mirror alone is overwritten on load): pick its card.
async function setTheme(id) {
  await escape()
  await click('button[aria-label]', 'settings|설정')
  await sleep(700)
  await click('*', `^${id}\\s*$`, true)
  await sleep(700)
  const shown = await evaluate('document.documentElement.dataset.theme')
  if (shown !== id) throw new Error(`theme ${id} not applied (page shows ${shown})`)
  await click('button', '^\\s*(Back|뒤로)\\s*$') // Settings is an overlay on the page behind it; Ctrl+1 would not close it
  await sleep(300)
  await digit(1)()
  await sleep(500)
}
for (const theme of themes) {
  await setTheme(theme)
  shots = {}
  for (const [w, h] of sizes) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    for (const [i, [name, go]] of PAGES.entries()) {
      await escape()
      await escape()
      await click('.start-page button[aria-label]', 'close') // Start is a page-sized overlay that stays up until closed
      await evaluate('document.activeElement?.blur()') // no stale focus ring from the previous step
      await sleep(200)
      const ok = await go()
      await sleep(1100) // overlays fade in; a shot taken mid-fade is washed out
      if (ok === false) {
        console.warn(`skip ${name} (${w}x${h} ${theme}): not reachable`)
        continue
      }
      // Page text with digits blanked: the status bar's countdowns tick between shots, pixels would never match.
      const text = (await evaluate(`document.body.innerText`)).replace(/\d+/g, '#')
      shots[name] = text
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' })
      if (DIFFERS[name] && text === shots[DIFFERS[name]]) {
        console.warn(`skip ${name} (${w}x${h} ${theme}): needs a project or plan the app does not have`)
        continue
      }
      const file = `${w}x${h}-${theme}-${pad(i + 1)}-${name}.png`
      writeFileSync(join(out, file), Buffer.from(data, 'base64'))
      console.log(file)
      count++
    }
    await escape()
    await escape()
  }
}
await cdp('Emulation.clearDeviceMetricsOverride')
if (initialTheme !== themes.at(-1)) await setTheme(initialTheme)
console.log(`${count} screenshots in ${out}`)
ws.close()
