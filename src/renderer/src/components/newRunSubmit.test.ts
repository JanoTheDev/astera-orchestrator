import { describe, expect, it } from 'vitest'
import { newRunSubmit } from './newRunSubmit'

describe('newRunSubmit', () => {
  it('plans at once when no plan is picked', () => {
    expect(newRunSubmit({ id: 'j1', after: '', plan: true, scheduled: false })).toEqual({ cmd: 'jobs-plan', args: { id: 'j1' } })
  })
  it('queues behind the picked plan with jobs-set instead of jobs-plan', () => {
    expect(newRunSubmit({ id: 'j1', after: 'j0', plan: true, scheduled: false })).toEqual({ cmd: 'jobs-set', args: { id: 'j1', after: 'j0' } })
  })
  it('sends nothing without the planner', () => {
    expect(newRunSubmit({ id: 'j1', after: 'j0', plan: false, scheduled: false })).toBeNull()
  })
  it('sends nothing for a schedule, even with a plan picked', () => {
    expect(newRunSubmit({ id: 'j1', after: 'j0', plan: true, scheduled: true })).toBeNull()
  })
})
