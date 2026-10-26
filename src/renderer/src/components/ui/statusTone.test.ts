import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../../../../core/types'
import { MEANING_COLOR, TASK_MEANING, taskStatusColor, taskStatusTone } from './statusTone'

const STATUSES: TaskStatus[] = ['pending', 'ready', 'dispatched', 'validating', 'reviewing', 'merging', 'completed', 'failed', 'blocked']

describe('statusTone', () => {
  it('gives every TaskStatus a colour and a tone', () => {
    for (const s of STATUSES) {
      expect(taskStatusColor(s)).toMatch(/^var\(--/)
      expect(taskStatusTone(s)).toBeTruthy()
    }
  })
  it('running and dispatched share one', () => {
    expect(taskStatusColor('dispatched')).toBe(MEANING_COLOR.running)
    expect(MEANING_COLOR.running).toBe('var(--info)')
  })
  it('checking states share one', () => {
    expect(new Set(['validating', 'reviewing', 'merging'].map((s) => taskStatusColor(s as TaskStatus))).size).toBe(1)
  })
  it('no two meanings share a colour', () => {
    const colours = Object.values(MEANING_COLOR)
    expect(new Set(colours).size).toBe(colours.length)
    expect(TASK_MEANING.failed).not.toBe(TASK_MEANING.blocked)
    expect(taskStatusColor('failed')).toBe('var(--danger)')
    expect(taskStatusColor('blocked')).toBe('var(--warn)')
  })
})

describe('task kind colours', () => {
  it('never use a status colour', () => {
    const css = readFileSync(join(__dirname, '../plan/planBoard.css'), 'utf8')
    const kinds = [...css.matchAll(/\.plan-kind--\w+ \{ --plan-kind: (var\(--[\w-]+\)); \}/g)].map((m) => m[1])
    expect(kinds.length).toBe(8)
    const status = [...Object.values(MEANING_COLOR), ...STATUSES.map(taskStatusColor), 'var(--accent)']
    for (const k of kinds) expect(status).not.toContain(k)
  })
})
