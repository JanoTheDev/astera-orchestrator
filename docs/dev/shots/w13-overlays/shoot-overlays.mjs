import { mkdirSync, writeFileSync } from 'node:fs'
const port = 9361
const out = process.argv[2]
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
const ev = async (e) => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value
const CTRL = 2, SHIFT = 8
async function key(k, code, vk, modifiers = 0) {
  const b = { key: k, code, windowsVirtualKeyCode: vk, modifiers }
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...b }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...b })
}
const type = async (s) => { await cdp('Input.insertText', { text: s }); await sleep(250) }
const shot = async (name) => { await sleep(700); const { data } = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64')); console.log(name, await ev('document.documentElement.dataset.theme')) }
const esc = () => key('Escape', 'Escape', 27)
const palette = () => key('P', 'KeyP', 80, CTRL | SHIFT)
const quick = () => key('p', 'KeyP', 80, CTRL)
const enter = () => key('Enter', 'Enter', 13)
const down = () => key('ArrowDown', 'ArrowDown', 40)
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await sleep(500)
async function theme(name) { // through the palette itself: Color Theme… then the row
  await esc(); await palette(); await sleep(300); await type('color theme'); await enter(); await sleep(300)
  await type(name); await sleep(300); await enter(); await sleep(800)
}
for (const t of ['night', 'day']) {
  await theme(t)
  const v = await ev('document.documentElement.dataset.theme')
  if (v !== t) throw new Error('theme ' + t + ' got ' + v)
  await esc(); await sleep(300)
  await palette(); await sleep(400); await shot(`1440x900-${t}-palette`)
  await type('plan'); await shot(`1440x900-${t}-palette-filtered`)
  await esc(); await sleep(300)
  await quick(); await sleep(400); await shot(`1440x900-${t}-quick-open-tabs`)
  await type('demo'); await shot(`1440x900-${t}-quick-open-search`)
  await esc(); await sleep(300)
  await quick(); await sleep(300); await type('>'); await type('show'); await shot(`1440x900-${t}-quick-open-commands`)
  await esc(); await sleep(300)
  await palette(); await sleep(300); await type('keyboard shortcuts'); await enter(); await sleep(900)
  await shot(`1440x900-${t}-shortcuts`)
  await ev(`(document.querySelector('.keys-view input[type=search]')||{}).focus?.()`)
  await type('palette'); await shot(`1440x900-${t}-shortcuts-search`)
  await key('F1', 'F1', 112); await sleep(500); await shot(`1440x900-${t}-help`)
  await esc(); await sleep(300)
}
await cdp('Emulation.clearDeviceMetricsOverride')
ws.close()
