import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, readdirSync, writeFileSync, utimesSync, mkdirSync, chmodSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { reportOf, type CrashEnv } from './report'
import { markOffered, pendingReports, readReport, tailSync, writeReportSync, CRASH_DIR } from './store'

const env: CrashEnv = { version: '1', build: '', os: 'linux', arch: 'x64' }
const rep = (): ReturnType<typeof reportOf> => reportOf({ process: 'main', kind: 'uncaughtException', error: new Error('x'), env })

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'astera-crash-'))
  dir = path.join(root, CRASH_DIR)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('writeReportSync', () => {
  it('writes one JSON file, dir 700 and file 600 whatever the umask', () => {
    const old = process.umask(0o002)
    try {
      const id = writeReportSync(dir, rep())
      expect(readdirSync(dir)).toEqual([id])
      if (process.platform !== 'win32') {
        expect(statSync(dir).mode & 0o777).toBe(0o700)
        expect(statSync(path.join(dir, id)).mode & 0o777).toBe(0o600)
      }
    } finally {
      process.umask(old)
    }
  })

  it('tightens a directory that already exists too open', () => {
    if (process.platform === 'win32') return
    mkdirSync(dir, { mode: 0o775 })
    chmodSync(dir, 0o775)
    writeReportSync(dir, rep())
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('prunes past the newest 20', () => {
    for (let i = 0; i < 22; i++) writeReportSync(dir, rep())
    expect(readdirSync(dir)).toHaveLength(20)
  })

  it('prunes reports older than 30 days', () => {
    const id = writeReportSync(dir, rep())
    const old = (Date.now() - 31 * 86_400_000) / 1000
    utimesSync(path.join(dir, id), old, old)
    writeReportSync(dir, rep())
    expect(readdirSync(dir)).not.toContain(id)
  })
})

describe('pending / offered', () => {
  it('lists reports not yet offered, once', async () => {
    const a = writeReportSync(dir, rep())
    expect((await pendingReports(dir)).map((p) => p.id)).toEqual([a])
    await markOffered(dir, a)
    expect(await pendingReports(dir)).toEqual([])
    expect((await readReport(dir, a))?.offered).toBe(true)
  })

  it('is empty when there is no directory', async () => {
    expect(await pendingReports(path.join(root, 'none'))).toEqual([])
  })

  it('skips files that are not reports', async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'junk.json'), '{nope')
    writeFileSync(path.join(dir, 'other.json'), '{"a":1}')
    expect(await pendingReports(dir)).toEqual([])
  })

  it('refuses an id that is not a plain report file name', async () => {
    expect(await readReport(dir, '../app-settings.json')).toBeNull()
    expect(await readReport(dir, 'x/y.json')).toBeNull()
  })
})

describe('tailSync', () => {
  it('reads the end of a file, or nothing', () => {
    const p = path.join(root, 'a.log')
    writeFileSync(p, 'a\n'.repeat(5000) + 'last\n')
    expect(tailSync(p, 100)?.endsWith('last\n')).toBe(true)
    expect(tailSync(p, 100)!.length).toBeLessThanOrEqual(100)
    expect(tailSync(path.join(root, 'none.log'))).toBeUndefined()
  })
})
