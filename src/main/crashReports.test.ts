import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCrashReports, registerCrashReports } from './crashReports'
import type { CrashReportsSetting } from '../core/crash/report'

let dir: string
let opened: string[]
let setting: CrashReportsSetting
beforeEach(() => {
  dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'astera-crash-main-')), 'crash-reports')
  opened = []
  setting = 'ask'
})
afterEach(() => rmSync(path.dirname(dir), { recursive: true, force: true }))

const make = (): ReturnType<typeof createCrashReports> =>
  createCrashReports({
    dir,
    env: { version: '9.9.9', build: 'c0ffee', os: 'linux', arch: 'x64', home: '/home/jane' },
    setting: () => setting,
    openExternal: (u) => opened.push(u)
  })
const files = (): string[] => readdirSync(dir)

describe('createCrashReports', () => {
  it('writes a repeat of the same failure once', () => {
    const r = make()
    const e = new Error('m')
    expect(r.record('main', 'uncaughtException', e)).toMatch(/\.json$/)
    expect(r.record('main', 'uncaughtException', e)).toBeNull()
    expect(files()).toHaveLength(1)
  })

  it('offers a report from before once, and nothing while the setting is never', async () => {
    const r = make()
    r.record('main', 'uncaughtException', new Error('m'))
    setting = 'never'
    expect(await r.pending()).toEqual([])
    setting = 'ask'
    const [offer, ...rest] = await r.pending()
    expect(rest).toEqual([])
    expect(offer).toMatchObject({ ask: true })
    expect(offer.body).toContain('9.9.9')
    expect(await r.pending()).toEqual([])
    // never: the report stays on disk
    expect(files()).toHaveLength(1)
  })

  it("takes the renderer's name and stack, never more, and hands back what the prompt shows", async () => {
    const r = make()
    const offer = await r.fromRenderer({ kind: 'error', name: 'TypeError', stack: 'TypeError: ghp_secret\n    at f (/home/jane/x.js:1:1)', message: 'ghp_secret' })
    expect(offer?.title).toContain('TypeError')
    expect(offer?.body).toContain('at f (~/x.js:1:1)')
    expect(readFileSync(path.join(dir, offer!.id), 'utf8')).not.toContain('secret')
    // shown now, so not offered again at the next start
    expect(await r.pending()).toEqual([])
    expect(await r.fromRenderer({ kind: 'rm -rf', name: 'x' })).toBeNull()
    expect(await r.fromRenderer('nope')).toBeNull()
  })

  it('still hands the report to the Report button while the setting is never, without asking', async () => {
    setting = 'never'
    const offer = await make().fromRenderer({ kind: 'render', name: 'Error', stack: '' })
    expect(offer?.ask).toBe(false)
  })

  it('opens the issue page only on send, with the body built from the file', async () => {
    const r = make()
    const offer = await r.fromRenderer({ kind: 'render', name: 'RangeError', stack: '    at g (a.js:1:1)' })
    expect(opened).toEqual([])
    expect(await r.send(offer!.id)).toBe(true)
    expect(opened).toHaveLength(1)
    const u = new URL(opened[0])
    expect(`${u.origin}${u.pathname}`).toBe('https://github.com/JanoTheDev/astera-orchestrator/issues/new')
    expect(u.searchParams.get('body')).toBe(offer!.body)
    expect(await r.send('../app-settings.json')).toBe(false)
    expect(await r.send(42)).toBe(false)
    expect(opened).toHaveLength(1)
  })
})

describe('registerCrashReports', () => {
  it('records main failures and processes that went away, but not a clean exit', () => {
    const l: Record<string, (...a: unknown[]) => void> = {}
    const on = (ev: string, fn: (...a: unknown[]) => void): void => void (l[ev] = fn)
    const got: string[] = []
    registerCrashReports({ on } as never, { on } as never, { record: (p, k, e) => (got.push(`${p} ${k} ${(e as { name: string }).name}`), null) })
    l.uncaughtExceptionMonitor(new TypeError('x'), 'uncaughtException')
    l.unhandledRejection(new RangeError('x'))
    l['render-process-gone']({}, {}, { reason: 'crashed' })
    l['render-process-gone']({}, {}, { reason: 'clean-exit' })
    l['child-process-gone']({}, { type: 'GPU', reason: 'oom' })
    l['child-process-gone']({}, { type: 'Utility', reason: 'clean-exit' })
    expect(got).toEqual([
      'main uncaughtException TypeError',
      'main unhandledRejection RangeError',
      'renderer render-process-gone crashed',
      'child child-process-gone GPU oom'
    ])
  })
})
