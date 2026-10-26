// The completion check plugin contract (plugin Phase 5 C3-C5, C10): the id a Task's check list names a plugin by, the
// input Astera asks with, the checks and cuts of an answer, and the text a repair request and a status message carry.
import { describe, it, expect } from 'vitest'
import type { OrchState } from './state'
import type { Task } from './types'
import {
  checkAnswerOf,
  checkInputOf,
  diagnosticLine,
  pluginCheckText,
  pluginIdOfCheck,
  skippedResult,
  skipReasonOf,
  CHECK_DIAGNOSTICS_MAX,
  SKIPPED_PREFIX,
  type CheckDiagnostic,
  type PluginCheckAnswer
} from './pluginChecks'
import type { CompletionCheckDiagnostic, CompletionCheckResult } from '../../../packages/plugin-sdk/src/index'

// Plugin Phase 5 C1: what the plugin SDK types a check to be asked and to answer is what the Host sends and takes
describe('the plugin SDK’s completion-check types', () => {
  it('are the shapes the Host sends and keeps', () => {
    // Each takes the other, and they name the same fields: an optional field on one side alone fails too
    type Keys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? Keys<A, B> : false) : false
    const same: [Same<CompletionCheckDiagnostic, CheckDiagnostic>, Same<CompletionCheckResult['status'], PluginCheckAnswer['status']>] = [true, true]
    expect(same).toEqual([true, true])
    // A result the SDK types is one the Host keeps as it is
    const answer: CompletionCheckResult = {
      status: 'failed',
      summary: '1 leftover',
      diagnostics: [{ file: 'src/a.js', line: 2, message: 'adds console.log', severity: 'warning' }],
      externalUrl: 'https://ci.example/1'
    }
    expect(checkAnswerOf(answer)).toEqual(answer)
  })
})

describe('a plugin check id', () => {
  it('is plugin:<id>', () => {
    expect(pluginIdOfCheck('plugin:astera-debug')).toBe('astera-debug')
    expect(pluginIdOfCheck('npm-test')).toBeNull()
    expect(pluginIdOfCheck('plugin:')).toBeNull()
  })
})

describe('a plugin’s answer (C5)', () => {
  it('keeps a well-formed answer', () => {
    const answer = {
      status: 'failed',
      summary: '2 leftovers',
      diagnostics: [{ file: 'a.js', line: 3, message: 'adds console.log', severity: 'error' }],
      externalUrl: 'https://ci.example/1'
    }
    expect(checkAnswerOf(answer)).toEqual(answer)
  })

  it('says the status word for an absent or blank summary', () => {
    expect(checkAnswerOf({ status: 'passed' })).toEqual({ status: 'passed', summary: 'passed' })
    expect(checkAnswerOf({ status: 'failed', summary: '  ' })).toEqual({ status: 'failed', summary: 'failed' })
  })

  it('cuts the summary, the message and the file, and drops what is not a line, a severity or a link', () => {
    const r = checkAnswerOf({
      status: 'failed',
      summary: 'x'.repeat(5000),
      externalUrl: 'javascript:alert(1)',
      diagnostics: [
        { message: 'm'.repeat(5000), file: 'f'.repeat(900), line: 0, severity: 'fatal' },
        { message: 'b', line: '12' },
        { message: 'c', line: 1.5 },
        { message: 'd', file: 7, line: 4 }
      ]
    })
    expect(r.status).toBe('failed')
    expect(r.summary.length).toBeLessThanOrEqual(1000)
    expect(r.externalUrl).toBeUndefined()
    expect(r.diagnostics![0].message.length).toBeLessThanOrEqual(1000)
    expect(r.diagnostics![0].file!.length).toBeLessThanOrEqual(500)
    expect(r.diagnostics![0]).not.toHaveProperty('line')
    expect(r.diagnostics![0]).not.toHaveProperty('severity')
    expect(r.diagnostics!.slice(1)).toEqual([{ message: 'b' }, { message: 'c' }, { message: 'd', line: 4 }])
  })

  it('drops a link longer than 2,048 characters rather than cutting it', () => {
    expect(checkAnswerOf({ status: 'passed', externalUrl: `https://x.example/${'a'.repeat(2100)}` })).not.toHaveProperty('externalUrl')
    expect(checkAnswerOf({ status: 'passed', externalUrl: 'http://x.example/r' }).externalUrl).toBe('http://x.example/r')
  })

  // 5d (performance review H1): 20 findings are kept, the count says how many there were, and the summary is the plugin's
  it('keeps the first 20 diagnostics and counts them all', () => {
    const r = checkAnswerOf({ status: 'failed', summary: 'many', diagnostics: Array.from({ length: 150 }, (_, i) => ({ message: `m${i}` })) })
    expect(CHECK_DIAGNOSTICS_MAX).toBe(20)
    expect(r.diagnostics).toHaveLength(20)
    expect(r.diagnostics?.[19].message).toBe('m19')
    expect(r.diagnosticsTotal).toBe(150)
    expect(r.summary).toBe('many')
    const few = checkAnswerOf({ status: 'failed', summary: 'few', diagnostics: Array.from({ length: 20 }, () => ({ message: 'm' })) })
    expect(few.diagnostics).toHaveLength(20)
    expect(few).not.toHaveProperty('diagnosticsTotal')
  })

  // 5d: a plugin with thousands of findings sends 20 and says how many, rather than sending them all to be cut
  it('takes the count a plugin gives when it is more than it sent, and ignores one that is not a count', () => {
    const twenty = Array.from({ length: 20 }, () => ({ message: 'm' }))
    expect(checkAnswerOf({ status: 'failed', diagnostics: twenty, diagnosticsTotal: 10_000 }).diagnosticsTotal).toBe(10_000)
    expect(checkAnswerOf({ status: 'failed', diagnostics: twenty, diagnosticsTotal: 5 })).not.toHaveProperty('diagnosticsTotal')
    expect(checkAnswerOf({ status: 'failed', diagnostics: twenty, diagnosticsTotal: 30.5 })).not.toHaveProperty('diagnosticsTotal')
    expect(checkAnswerOf({ status: 'failed', diagnostics: twenty, diagnosticsTotal: '30' })).not.toHaveProperty('diagnosticsTotal')
    expect(checkAnswerOf({ status: 'failed', summary: 'none listed', diagnosticsTotal: 4 }).diagnosticsTotal).toBe(4)
  })

  it('leaves out an empty list of diagnostics', () => {
    expect(checkAnswerOf({ status: 'passed', diagnostics: [] })).toEqual({ status: 'passed', summary: 'passed' })
  })

  it('turns an answer of the wrong shape into error, saying why', () => {
    const wrong: unknown[] = [
      null,
      'passed',
      [],
      { status: 'ok' },
      { status: 'failed', summary: 3 },
      { status: 'failed', diagnostics: {} },
      { status: 'failed', diagnostics: [{ file: 'a' }] },
      { status: 'failed', diagnostics: [{ message: '  ' }] },
      { status: 'failed', diagnostics: ['x'] }
    ]
    for (const raw of wrong) {
      const r = checkAnswerOf(raw)
      expect(r.status).toBe('error')
      expect(r.summary).toMatch(/^the plugin answered with something that is not a check result: /)
    }
  })
})

describe('the text a repair request and a status message carry (C10)', () => {
  it('is the summary, the first 20 findings as file:line message, and the link', () => {
    const text = pluginCheckText({
      configId: 'plugin:d',
      name: 'Debug leftovers',
      status: 'failed',
      summary: '22 leftovers',
      externalUrl: 'https://x.example/r',
      diagnostics: Array.from({ length: 22 }, (_, i) => ({ file: 'src/a.js', line: i + 1, message: 'adds console.log' }))
    })!
    const lines = text.split('\n')
    expect(lines[0]).toBe('22 leftovers')
    expect(lines[1]).toBe('src/a.js:1 adds console.log')
    expect(lines[20]).toBe('src/a.js:20 adds console.log')
    expect(lines[21]).toBe('… 2 more finding(s)')
    expect(lines.at(-1)).toBe('Details: https://x.example/r')
  })

  // 5d: the Host keeps 20; the count says how many more the plugin found
  it('counts the findings the Host did not keep', () => {
    const text = pluginCheckText({
      configId: 'plugin:d',
      name: 'Debug leftovers',
      status: 'failed',
      summary: '150 leftovers',
      diagnostics: Array.from({ length: 20 }, (_, i) => ({ file: 'src/a.js', line: i + 1, message: 'adds console.log' })),
      diagnosticsTotal: 150
    })!
    expect(text.split('\n').at(-1)).toBe('… 130 more finding(s)')
  })

  it('is the summary alone when there is nothing else', () => {
    expect(pluginCheckText({ configId: 'plugin:d', name: 'D', status: 'error', summary: 'service down' })).toBe('service down')
  })

  it('is null for a command check', () => {
    expect(pluginCheckText({ configId: 'npm-test', name: 'Tests', status: 'failed', exitCode: 1, outputTail: 'boom' })).toBeNull()
  })

  it('names a file without a line, a finding without a file, and a warning', () => {
    expect(diagnosticLine({ file: 'a.js', message: 'm' })).toBe('a.js m')
    expect(diagnosticLine({ message: 'm' })).toBe('m')
    expect(diagnosticLine({ file: 'a.js', line: 2, message: 'm', severity: 'warning' })).toBe('a.js:2 warning: m')
  })
})

describe('the input (C3)', () => {
  const task = { id: 't1', runId: 'run1', title: 'Fix it' } as Task
  it('names the Job, the Run, the Task, the folder and the commits the Task worked between', () => {
    const s = {
      jobs: [{ id: 'job1', projectId: 'prj1', cwd: 'P' }],
      runs: [{ id: 'run1', jobId: 'job1', git: { base: 'r0' } }],
      tasks: [task],
      dispatches: [
        { id: 'd2', taskId: 't1', startedAt: '2026-10-14T02:00:00Z', cwd: 'W', repair: 'check-failure', git: { base: 'h1', head: 'h2' } },
        { id: 'd1', taskId: 't1', startedAt: '2026-10-14T01:00:00Z', cwd: 'W', git: { base: 'b1', head: 'h1' } },
        { id: 'r1', taskId: 't1', startedAt: '2026-10-14T03:00:00Z', cwd: 'W', review: true, git: { base: 'z', head: 'z' } },
        { id: 'o1', taskId: 'other', startedAt: '2026-10-14T00:00:00Z', cwd: 'W', git: { base: 'o', head: 'o' } }
      ]
    } as unknown as OrchState
    expect(checkInputOf(s, task, 'W')).toEqual({
      projectId: 'prj1',
      jobId: 'job1',
      runId: 'run1',
      taskId: 't1',
      task: { title: 'Fix it' },
      workspace: { root: 'W', base: 'b1', head: 'h2' }
    })
  })

  it('falls back to the Run’s base, and leaves out what it does not know', () => {
    const s = { jobs: [{ id: 'job1', cwd: 'P' }], runs: [{ id: 'run1', jobId: 'job1', git: { base: 'r0' } }], tasks: [task], dispatches: [] } as unknown as OrchState
    const input = checkInputOf(s, task, 'P')
    expect(input.workspace).toEqual({ root: 'P', base: 'r0' })
    expect(input).not.toHaveProperty('projectId')
  })
})

// Plugin Phase 5c: a screen says "skipped" in its own words, then the reason the record keeps
describe('a skipped check’s reason', () => {
  it('skipReasonOf gives the reason a skipped check could not be made, without the record’s English words', () => {
    const skipped = skippedResult({ configId: 'plugin:d', name: 'D', status: 'error', summary: 'astera-d is stopped' })
    expect(skipped.summary).toBe(`${SKIPPED_PREFIX}astera-d is stopped`)
    expect(skipReasonOf(skipped.summary)).toBe('astera-d is stopped')
    expect(skipReasonOf('a summary of its own')).toBe('a summary of its own')
    expect(skipReasonOf(undefined)).toBeUndefined()
  })
})
