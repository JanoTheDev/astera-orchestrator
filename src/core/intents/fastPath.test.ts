import { describe, expect, it } from 'vitest'
import { fastParse } from './fastPath'

describe('fastParse — SPEC §8 phrasings read without a model', () => {
  it.each([
    ['Switch to Gameful Trading', { kind: 'switch', target: 'Gameful Trading' }],
    ['Show the Value List terminals', { kind: 'show-sessions', target: 'Value List' }],
    ['Pause the Console plan', { kind: 'pause', target: 'Console' }],
    ['Pause worker three', { kind: 'pause', target: 'worker three' }],
    ['Resume Console', { kind: 'resume', target: 'Console' }],
    ['Summarize active Trading workers', { kind: 'summarize', target: 'Trading' }],
    ['Summarize the last 15 min', { kind: 'summarize', minutes: 15 }],
    ['summarize the past two hours', { kind: 'summarize', minutes: 120 }],
    ['Show progress on Redis', { kind: 'summarize', target: 'Redis' }],
    ['Show every session needing my input', { kind: 'waiting' }],
    ['What are workers waiting for?', { kind: 'waiting' }],
    ['Stop launching new tasks for this plan', { kind: 'stop-launching' }],
    ['Stop launching new tasks for Console', { kind: 'stop-launching', target: 'Console' }],
    ['Stop the Console plan', { kind: 'stop', target: 'Console' }],
    ['Start executing the approved plan', { kind: 'approve' }],
    ['approve Console', { kind: 'approve', target: 'Console' }],
    ['Plan the next Gameful refactor', { kind: 'plan', objective: 'the next Gameful refactor' }],
    ['send "run the tests" to the API worker', { kind: 'send', text: 'run the tests', session: 'API worker' }],
    ['send add a note to the readme to worker 2', { kind: 'send', text: 'add a note to the readme', session: 'worker 2' }]
  ])('%s', (text, want) => {
    expect(fastParse(text)).toEqual(want)
  })

  it.each(['Send this to the API worker', 'what is the weather', 'Start the next eligible Value List tasks', ''])(
    'leaves %j to the coordinator model',
    (text) => {
      expect(fastParse(text)).toBeNull()
    }
  )
})
