// A Job's name where it is shown (plugin 4d): one rule for the app, the CLI, How It Works and the notifications.
import { describe, it, expect } from 'vitest'
import { jobDisplayName, jobNameOf } from './jobName'

describe('jobNameOf', () => {
  it('is the ticket’s title for a Job made from one, else its objective', () => {
    const source = { id: 'astera-linear-source', itemId: 'ENG-1', label: 'Linear ENG-1', title: 'Fix login' }
    expect(jobNameOf({ objective: 'Resolve Linear ENG-1.', source })).toBe('Fix login')
    const { title: _title, ...old } = source
    expect(jobNameOf({ objective: 'Ship it', source: old })).toBe('Ship it')
    expect(jobNameOf({ objective: 'Ship it' })).toBe('Ship it')
  })
})

describe('jobDisplayName', () => {
  it('is the title, else the ticket’s title, as jobNameOf', () => {
    expect(jobDisplayName({ objective: 'x', title: 'Auth rework' })).toBe('Auth rework')
    expect(jobDisplayName({ objective: 'x', source: { id: 's', itemId: '1', label: 'L', title: 'Fix login' } })).toBe('Fix login')
  })

  it('keeps a short objective whole', () => {
    expect(jobDisplayName({ objective: '  Ship it  ' })).toBe('Ship it')
  })

  it('takes the first sentence or line of a long objective', () => {
    expect(jobDisplayName({ objective: 'Add a dark mode toggle. Then make it remember the choice across restarts of the app.' })).toBe('Add a dark mode toggle')
    expect(jobDisplayName({ objective: 'Redesign the plans page\nGOAL: make it readable at every width' })).toBe('Redesign the plans page')
  })

  it('cuts a long run-on prompt at a word boundary, never mid-word', () => {
    const objective = 'aslo what i realize is that in the tasks there is alot of repetition of the same affected Tasks and prompts'
    const name = jobDisplayName({ objective })
    expect(name.length).toBeLessThanOrEqual(61)
    expect(name.endsWith('…')).toBe(true)
    const words = name.slice(0, -1).split(' ')
    expect(objective.split(' ').slice(0, words.length)).toEqual(words)
  })

  it('cuts one endless word at the limit rather than not at all', () => {
    expect(jobDisplayName({ objective: 'x'.repeat(100) })).toBe(`${'x'.repeat(60)}…`)
  })
})
