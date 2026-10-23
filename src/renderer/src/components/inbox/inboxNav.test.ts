// openTargetOf / lineTargetOf: where a Needs you row's Open and an Activity row lead.
import { describe, expect, it } from 'vitest'
import { lineTargetOf, openTargetOf } from './inboxNav'

describe('openTargetOf', () => {
  it('a permission or waiting wait opens its console', () => {
    expect(openTargetOf({ kind: 'permission', jobId: 'j1', taskId: 't1', sessionId: 's1' })).toEqual({ kind: 'console', sessionId: 's1' })
    expect(openTargetOf({ kind: 'waiting', jobId: 'j1', sessionId: 's2' })).toEqual({ kind: 'console', sessionId: 's2' })
  })
  it('a question with a Task opens the plan tab at that Task', () => {
    expect(openTargetOf({ kind: 'question', jobId: 'j1', taskId: 't1' })).toEqual({ kind: 'plan', jobId: 'j1', taskId: 't1', tab: 'view:plan:j1#task-t1' })
  })
  it('an approval opens the plan tab, with no anchor, even with a planner session', () => {
    expect(openTargetOf({ kind: 'approval', jobId: 'j1', sessionId: 'pl1' })).toEqual({ kind: 'plan', jobId: 'j1', tab: 'view:plan:j1' })
  })
})

describe('lineTargetOf', () => {
  it('prefers the plan (at the Task), falls back to the console, else none', () => {
    expect(lineTargetOf({ jobId: 'j1', taskId: 't1', sessionId: 's1' })).toMatchObject({ kind: 'plan', tab: 'view:plan:j1#task-t1' })
    expect(lineTargetOf({ sessionId: 's1' })).toEqual({ kind: 'console', sessionId: 's1' })
    expect(lineTargetOf({})).toBeNull()
  })
})
