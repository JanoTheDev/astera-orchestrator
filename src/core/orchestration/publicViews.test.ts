// The Job, Run and brief Task views the reads answer with (and the public events carry, SDK 1d).
import { describe, it, expect } from 'vitest'
import { briefQuestion, briefTask } from './publicViews'
import type { Task } from './types'

const task = (spec: string): Task => ({
  id: 't1',
  runId: 'run_1',
  title: 't',
  spec,
  deps: [],
  status: 'ready',
  consecutiveFailures: 0,
  createdAt: 'T',
  updatedAt: 'T'
})

describe('briefTask', () => {
  it('collapses whitespace and cuts the spec at 160 characters, marking the cut', () => {
    const long = `line one\n\n  line two\t${'x'.repeat(200)}`
    const out = briefTask(task(long))
    expect(out.spec).toBe(long.replace(/\s+/g, ' ').slice(0, 160))
    expect(out.spec_truncated).toBe(true)
    expect(out.id).toBe('t1')
  })

  it('marks a short spec as whole', () => {
    expect(briefTask(task('a  b'))).toMatchObject({ spec: 'a b', spec_truncated: false })
  })
})

describe('briefQuestion', () => {
  it('puts the question and the resolution on one line, cut at 160 characters ending in …', () => {
    const out = briefQuestion({ id: 'q1', question: `which\n  one ${'y'.repeat(200)}`, resolution: 'a\nb' })
    expect(out.question).toBe(`which one ${'y'.repeat(150)}…`)
    expect(out.resolution).toBe('a b')
    expect(out.id).toBe('q1')
  })

  it('leaves a short question whole and adds no resolution', () => {
    expect(briefQuestion({ question: 'ok?' })).toEqual({ question: 'ok?' })
  })
})
