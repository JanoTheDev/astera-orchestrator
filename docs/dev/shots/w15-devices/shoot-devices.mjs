// The w15-devices shots, driven over CDP like w13-overlays: node shoot-devices.mjs <port> <outdir>. See NOTES.md for the
// profile it expects (two paired Runtimes, one of them stopped, and a beacon on the network).
import { mkdirSync, writeFileSync } from 'node:fs'
const port = Number(process.argv[2])
const out = process.argv[3]
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const target = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')) })
let n = 0
const pend = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); const p = pend.get(m.id); if (!p) return; pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) }
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++n; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (e) => {
  const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`${e.slice(0, 80)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}
const CTRL = 2, SHIFT = 8
async function key(k, code, vk, modifiers = 0) {
  const b = { key: k, code, windowsVirtualKeyCode: vk, modifiers }
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...b }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...b })
}
const type = async (s) => { await cdp('Input.insertText', { text: s }); await sleep(250) }
// the error toast MigratePanel raises for the stand-in device (see NOTES.md) is cleared before each shot
const clearToasts = () => ev(`document.querySelectorAll('.ui-toast button').forEach((b) => b.click())`)
const shot = async (name) => { await sleep(700); await clearToasts(); await sleep(300); const { data } = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64')); console.log(name) }
const esc = () => key('Escape', 'Escape', 27)
const enter = () => key('Enter', 'Enter', 13)
const palette = () => key('P', 'KeyP', 80, CTRL | SHIFT)
async function theme(name) {
  await esc(); await palette(); await sleep(300); await type('color theme'); await enter(); await sleep(300)
  await type(name); await sleep(300); await enter(); await sleep(800)
}
const click = (sel, text) => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) throw new Error('no ' + ${JSON.stringify(sel + ' ' + (text ?? ''))}); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.click() })()`)
// A step the shots cannot reach without a real SSH machine is set on the modal's own state (its useState hooks, in order).
const setHooks = (sel, comp, values) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)}); const k = Object.keys(el).find((x) => x.startsWith('__reactFiber'))
  let f = el[k]; while (f && !(typeof f.type === 'function' && f.type.name === ${JSON.stringify(comp)})) f = f.return
  const hooks = []; for (let h = f.memoizedState; h; h = h.next) hooks.push(h)
  for (const [i, v] of Object.entries(${JSON.stringify(values)})) hooks[i].queue.dispatch(v)
})()`)
// AddDeviceModal's hooks: 0 step, 3 target, 9 busy, 10 events, 11 result, 12 device, 13 migrated
const STEPS = ['connect', 'detect', 'installer', 'upload', 'install', 'pair', 'verify']
const okEvents = STEPS.map((step) => ({ step, state: 'done', line: { connect: 'Signed in to jon@192.168.10.40', detect: 'It runs Linux', installer: 'Using astera-1.4.14-amd64.deb', upload: 'Uploaded to /tmp/astera-k2-a8Df', install: 'Astera is installed and the Runtime is running', pair: 'Paired as build-box', verify: 'build-box answers' }[step] }))
const keyFix = 'Put your public key on the machine (ssh-copy-id -p 22 jon@192.168.10.40) and try again. Astera never asks for a password.'
const keyFail = { ok: false, step: 'connect', message: 'Could not sign in to jon@192.168.10.40', stderrTail: 'jon@192.168.10.40: Permission denied (publickey).', fix: keyFix }
const device = { runtimeId: 'rt_7b97b2c124719343', name: 'build-box' }

await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await sleep(500)
for (const t of ['night', 'day']) {
  await theme(t)
  const v = await ev('document.documentElement.dataset.theme')
  if (v !== t) throw new Error('theme ' + t + ' got ' + v)
  await esc(); await sleep(300)
  // the tabs the previous pass opened go, so each pass starts on the view alone
  for (let i = 0; i < 6; i++) await ev(`document.querySelector('.ui-etab__close')?.click()`)
  if (!(await ev(`document.querySelector('.ui-activity[aria-label^="Devices"]')?.getAttribute('aria-selected') === 'true'`))) await click('.ui-activity[aria-label^="Devices"]')
  await ev(`[...document.querySelectorAll('.wb-sidebar .ui-viewpane__toggle[aria-expanded=false]')].forEach((b) => b.click())`)
  await sleep(2500)
  await shot(`1440x900-${t}-view`)
  await click('.wb-sidebar [role=treeitem]', 'build-box'); await sleep(1500)
  await shot(`1440x900-${t}-device-tab`)
  await click('.wb-sidebar [role=treeitem]', 'old-laptop'); await sleep(1500)
  await shot(`1440x900-${t}-device-tab-offline`)
  await click('.wb-sidebar button[aria-label="Add studio-pc"]'); await sleep(600)
  await shot(`1440x900-${t}-add-choose`)
  await setHooks('.devices-modal', 'AddDeviceModal', { 0: 'connect', 3: 'jon@192.168.10.40', 10: okEvents.slice(0, 4).concat([{ step: 'install', state: 'running', line: 'Installing Astera and starting the Runtime (this takes a few minutes)' }]), 9: true })
  await shot(`1440x900-${t}-add-connect`)
  await setHooks('.devices-modal', 'AddDeviceModal', { 9: false, 10: [{ step: 'connect', state: 'failed', line: keyFail.message, stderrTail: keyFail.stderrTail, fix: keyFix }], 11: keyFail })
  await shot(`1440x900-${t}-add-connect-ssh-key`)
  await setHooks('.devices-modal', 'AddDeviceModal', { 10: okEvents, 11: { ok: true, runtimeId: device.runtimeId, name: device.name, os: 'linux', repaired: false }, 12: device })
  await shot(`1440x900-${t}-add-connect-done`)
  await setHooks('.devices-modal', 'AddDeviceModal', { 0: 'bring' }); await sleep(1500)
  // MigratePanel's hooks: 1 plan (this Runtime was paired without SSH, so its own plan is empty)
  await setHooks('.devices-migrate', 'MigratePanel', { 1: [
    { kind: 'github', id: 'gh', label: 'github.com as jon', detail: 'gh auth token' },
    { kind: 'git', id: 'name', label: 'user.name Jon', detail: '' },
    { kind: 'git', id: 'email', label: 'user.email jon@example.com', detail: '' },
    { kind: 'accounts', id: 'a1', label: 'Claude · jon@example.com', detail: 'a one-time login there' },
    { kind: 'accounts', id: 'a2', label: 'Codex · jon@example.com', detail: '' },
    { kind: 'projects', id: 'p1', label: 'demo-app', detail: 'git@github.com:jon/demo-app.git' }
  ] })
  await shot(`1440x900-${t}-add-bring`)
  await setHooks('.devices-modal', 'AddDeviceModal', { 0: 'done' })
  await shot(`1440x900-${t}-add-done`)
  await click('.ui-modal__foot button, .ui-modal button', 'Close'); await sleep(400)
  await click('.wb-sidebar [role=treeitem]', 'This computer'); await sleep(1500)
  await shot(`1440x900-${t}-settings-remote`)
}
await cdp('Emulation.clearDeviceMetricsOverride')
ws.close()
