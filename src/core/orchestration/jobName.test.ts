// A Job's name where it is shown (plugin 4d): one rule for the app, the CLI, How It Works and the notifications.
import { describe, it, expect } from 'vitest'
import { jobNameOf } from './jobName'

describe('jobNameOf', () => {
  it('is the ticket’s title for a Job made from one, else its objective', () => {
    const source = { id: 'astera-linear-source', itemId: 'ENG-1', label: 'Linear ENG-1', title: 'Fix login' }
    expect(jobNameOf({ objective: 'Resolve Linear ENG-1.', source })).toBe('Fix login')
    const { title: _title, ...old } = source
    expect(jobNameOf({ objective: 'Ship it', source: old })).toBe('Ship it')
    expect(jobNameOf({ objective: 'Ship it' })).toBe('Ship it')
  })
})
