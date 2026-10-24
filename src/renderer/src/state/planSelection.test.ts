import { describe, expect, it } from 'vitest'
import { openRunCheck, pendingAfterOpen, pendingRunStep } from './planSelection'
import type { JobRow, OrchSnapshot } from '../../../core/types'

const row = (id: string): JobRow => ({
  id, objective: id, outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: []
})
const snap = (project: string | undefined, runs: JobRow[]): OrchSnapshot => ({ runs, projectFolderBusy: false, ...(project ? { project } : {}) })

describe('openRunCheck', () => {
  const openRun = { projectPath: '/b', runId: 'rb' }

  it("keeps B's open plan when a push of project A lands after switching to B", () => {
    expect(openRunCheck({ openRun, currentProject: '/b', snap: snap('/a', [row('ra')]), seen: true })).toEqual({ close: false, found: false })
  })

  it("closes it when B's own snapshot no longer has the Run", () => {
    expect(openRunCheck({ openRun, currentProject: '/b', snap: snap('/b', []), seen: true }).close).toBe(true)
    expect(openRunCheck({ openRun, currentProject: '/b', snap: snap(undefined, []), seen: true }).close).toBe(true)
  })

  it('keeps it while the Run is there, and before the first snapshot', () => {
    expect(openRunCheck({ openRun, currentProject: '/b', snap: snap('/b', [row('rb')]), seen: false })).toEqual({ close: false, found: true })
    expect(openRunCheck({ openRun, currentProject: '/b', snap: null, seen: false }).close).toBe(false)
  })

  it('closes a local plan of another project than the current one', () => {
    expect(openRunCheck({ openRun, currentProject: '/a', snap: snap('/b', [row('rb')]), seen: true }).close).toBe(true)
  })
})

describe('pendingRunStep', () => {
  const pending = { projectPath: '/b', runId: 'rb' }

  it('opens once its project is current', () => {
    expect(pendingRunStep(pending, '/b', '/a')).toBe('open')
  })

  it('waits while the switch that brings its project has not landed', () => {
    expect(pendingRunStep(pending, '/a', '/a')).toBe('wait')
  })

  it('is dropped on a switch to an unrelated project, so it never steals focus later', () => {
    expect(pendingRunStep(pending, '/c', '/a')).toBe('drop')
    expect(pendingRunStep(pending, null, '/a')).toBe('drop')
  })
})

describe('pendingAfterOpen', () => {
  const pending = { projectPath: '/b', runId: 'rb' }

  it('drops the pending plan when the owner opens another one', () => {
    expect(pendingAfterOpen(pending, { projectPath: '/a', runId: 'ra' })).toBeNull()
  })

  it('keeps it for the plan it opened, and when nothing opened', () => {
    expect(pendingAfterOpen(pending, pending)).toBe(pending)
    expect(pendingAfterOpen(pending, null)).toBe(pending)
  })
})
