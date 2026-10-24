import { describe, it, expect } from 'vitest'
import type { Job, Task } from '../../../core/orchestration/types'
import type { WorkspaceData } from './workspaceTree'
import { keepUnchanged } from './useWorkspaceData'

const task = (id: string, status: string): Task => ({ id, status }) as unknown as Task
const job = (id: string): Job => ({ id }) as unknown as Job
const data = (tasks: Task[]): WorkspaceData => ({
  projects: [],
  jobsByProject: { p1: [job('j1')], p2: [] },
  runs: [],
  tasks,
  dispatches: [],
  gates: []
})
const copy = (d: WorkspaceData): WorkspaceData => JSON.parse(JSON.stringify(d))

describe('keepUnchanged', () => {
  it('keeps the held object when a fresh read equals it', () => {
    const prev = data([task('t1', 'running')])
    expect(keepUnchanged(prev, copy(prev))).toBe(prev)
  })

  it('replaces only the list that changed', () => {
    const prev = data([task('t1', 'running')])
    const next = copy(prev)
    next.tasks = [task('t1', 'done')]
    const out = keepUnchanged(prev, next)
    expect(out).not.toBe(prev)
    expect(out.tasks).toBe(next.tasks)
    expect(out.runs).toBe(prev.runs)
    expect(out.jobsByProject).toBe(prev.jobsByProject)
  })

  it('reuses unchanged per-project job lists', () => {
    const prev = data([])
    const next = copy(prev)
    next.jobsByProject.p2 = [job('j2')]
    const out = keepUnchanged(prev, next)
    expect(out.jobsByProject.p1).toBe(prev.jobsByProject.p1)
    expect(out.jobsByProject.p2).toEqual([job('j2')])
  })

  it('counts a field that appears or goes as a change', () => {
    const prev = data([])
    expect(keepUnchanged(prev, { ...copy(prev), escalations: [] })).not.toBe(prev)
  })
})
