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
