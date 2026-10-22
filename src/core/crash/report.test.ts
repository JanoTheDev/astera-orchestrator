import { describe, it, expect } from 'vitest'
import {
  crashReportsOf,
  formatReport,
  framesOf,
  ISSUE_NEW_URL,
  issueOf,
  MAX_ISSUE_URL,
  reportOf,
  toPrune,
  type CrashEnv
} from './report'

const env: CrashEnv = { version: '1.4.14', build: 'abc1234', os: 'linux 6.14.0', arch: 'x64', home: '/home/jane' }

function boom(): Error {
  const e = new Error('token=sk-ant-oat01-SECRETSECRETSECRET for jane@example.com')
  e.stack = [
    'Error: token=sk-ant-oat01-SECRETSECRETSECRET for jane@example.com',
    '    at run (/home/jane/astera/out/main/index.js:10:5)',
    '    at node:internal/process/task_queues:95:5',
    '    at <anonymous>'
  ].join('\n')
  return e
}

describe('reportOf', () => {
  it('keeps the name and redacted frames, never the message', () => {
    const r = reportOf({ process: 'main', kind: 'uncaughtException', error: boom(), env, at: new Date('2026-10-23T10:00:00Z') })
    expect(r.errorName).toBe('Error')
    expect(r.stack).toEqual(['at run (~/astera/out/main/index.js:10:5)', 'at node:internal/process/task_queues:95:5', 'at <anonymous>'])
    expect(JSON.stringify(r)).not.toContain('SECRET')
    expect(JSON.stringify(r)).not.toContain('jane')
    expect(r).toMatchObject({ version: '1.4.14', build: 'abc1234', os: 'linux 6.14.0', arch: 'x64', process: 'main', kind: 'uncaughtException', at: '2026-10-23T10:00:00.000Z' })
  })

  it('names a non-Error by its type', () => {
    expect(reportOf({ process: 'host', kind: 'unhandledRejection', error: 'boom sk-xyz', env }).errorName).toBe('string')
    expect(reportOf({ process: 'host', kind: 'unhandledRejection', error: undefined, env }).stack).toEqual([])
  })

  it('takes a name and a stack sent from the renderer, redacted', () => {
    const r = reportOf({ process: 'renderer', kind: 'error', error: { name: 'TypeError', stack: 'TypeError: secret\n    at f (http://localhost:5173/a.tsx?t=1:2:3)' }, env })
    expect(r.errorName).toBe('TypeError')
    expect(r.stack).toEqual(['at f (http://localhost:5173/a.tsx?[redacted])'])
  })

  it('carries the last lines of the log, redacted', () => {
    const r = reportOf({ process: 'host', kind: 'uncaughtException', error: boom(), env, log: 'a\nb\nc Bearer x\n', logLines: 2 })
    expect(r.log).toEqual(['b', 'c Bearer [redacted]'])
  })

  it('caps an odd name', () => {
    const r = reportOf({ process: 'renderer', kind: 'error', error: { name: 'x'.repeat(500) + ' jane@x.io' }, env })
    expect(r.errorName.length).toBeLessThanOrEqual(80)
  })
})

describe('framesOf', () => {
  it('reads only the at-lines, at most the limit', () => {
    expect(framesOf('E: m\n  at a\n  at b\n  at c', 2)).toEqual(['at a', 'at b'])
  })
})

describe('formatReport / issueOf', () => {
  const r = reportOf({ process: 'main', kind: 'uncaughtException', error: boom(), env, at: new Date('2026-10-23T10:00:00Z'), log: 'line one' })

  it('names version, build, OS, process, error and frames', () => {
    const text = formatReport(r)
    for (const s of ['1.4.14', 'abc1234', 'linux 6.14.0', 'x64', 'main', 'uncaughtException', 'Error', 'at run (~/astera/out/main/index.js:10:5)', 'line one'])
      expect(text).toContain(s)
  })

  it('points at the fork and carries the report in the body', () => {
    const issue = issueOf(r)
    expect(issue.url.startsWith(`${ISSUE_NEW_URL}?`)).toBe(true)
    expect(ISSUE_NEW_URL).toBe('https://github.com/JanoTheDev/astera-orchestrator/issues/new')
    const q = new URL(issue.url).searchParams
    expect(q.get('title')).toBe(issue.title)
    expect(q.get('body')).toBe(issue.body)
    expect(issue.title).toContain('Error')
    expect(issue.truncated).toBe(false)
  })

  it('caps the URL and marks the cut', () => {
    const big = reportOf({ process: 'host', kind: 'uncaughtException', error: boom(), env, log: Array.from({ length: 400 }, (_, i) => `line ${i} ü ${'z'.repeat(30)}`).join('\n'), logLines: 400 })
    const issue = issueOf(big)
    expect(issue.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL)
    expect(issue.truncated).toBe(true)
    expect(issue.body).toContain('(truncated)')
    expect(new URL(issue.url).searchParams.get('body')).toBe(issue.body)
  })
})

describe('toPrune', () => {
  const now = Date.parse('2026-10-23T00:00:00Z')
  const day = 86_400_000
  it('drops files older than 30 days', () => {
    expect(toPrune([{ name: 'old', mtimeMs: now - 31 * day }, { name: 'new', mtimeMs: now - day }], now)).toEqual(['old'])
  })
  it('keeps the newest 20', () => {
    const files = Array.from({ length: 25 }, (_, i) => ({ name: `f${i}`, mtimeMs: now - i * 1000 }))
    expect(toPrune(files, now).sort()).toEqual(['f20', 'f21', 'f22', 'f23', 'f24'])
  })
})

describe('crashReportsOf', () => {
  it('is never only when the file says never', () => {
    expect(crashReportsOf('never')).toBe('never')
    expect(crashReportsOf('ask')).toBe('ask')
    expect(crashReportsOf(undefined)).toBe('ask')
    expect(crashReportsOf(false)).toBe('ask')
  })
})
