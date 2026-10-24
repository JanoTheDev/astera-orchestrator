import { describe, it, expect } from 'vitest'
import { nextActivity, type SidebarEvent } from './sidebarView'

const run = (start: Parameters<typeof nextActivity>[0], events: SidebarEvent[]) => events.reduce(nextActivity, start)

describe('nextActivity', () => {
  it('an owner click changes the view', () => {
    expect(nextActivity('agents', { kind: 'click', activity: 'history' })).toBe('history')
  })

  it('an openRun change, a pushed snapshot, a plan page close and a late pending plan keep the view', () => {
    for (const kind of ['openRun', 'push', 'planClose', 'pendingPlan'] as const) {
      expect(nextActivity('scm', { kind })).toBe('scm')
      expect(nextActivity('devices', { kind })).toBe('devices')
    }
  })

  it('keeps a clicked view through every non-owner event that follows', () => {
    expect(
      run('plans', [{ kind: 'click', activity: 'run' }, { kind: 'openRun' }, { kind: 'pendingPlan' }, { kind: 'push' }, { kind: 'planClose' }])
    ).toBe('run')
  })

  it('the last of two quick clicks wins', () => {
    expect(run('agents', [{ kind: 'click', activity: 'plans' }, { kind: 'click', activity: 'history' }])).toBe('history')
  })

  it('a toggle opens its view, and pressed on that view goes back to Agents', () => {
    expect(nextActivity('scm', { kind: 'toggle', activity: 'explorer' })).toBe('explorer')
    expect(nextActivity('explorer', { kind: 'toggle', activity: 'explorer' })).toBe('agents')
  })

  it('two quick toggles read the view the first one left', () => {
    expect(run('agents', [{ kind: 'toggle', activity: 'plans' }, { kind: 'toggle', activity: 'plans' }])).toBe('agents')
  })
})
