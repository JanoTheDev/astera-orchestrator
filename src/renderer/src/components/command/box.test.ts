// W9-D: the merged box's mode choice (search vs command) and what its search finds.
import { describe, expect, it } from 'vitest'
import type { IndexedSession } from '../../../../core/orchestration/sessionIndex'
import { boxHits } from './boxHits'
import { boxModeOf } from './boxMode'

describe('boxModeOf', () => {
  it('empty text searches', () => expect(boxModeOf('  ', 0)).toBe('search'))
  it('a phrase the fast path knows is a command, even when it also finds something', () => {
    expect(boxModeOf('pause trading', 3)).toBe('command')
    expect(boxModeOf('approve L4', 1)).toBe('command')
  })
  it('a sentence is a command', () => {
    expect(boxModeOf('what is blocking the auth rework right now', 5)).toBe('command')
    expect(boxModeOf('who is working on auth?', 2)).toBe('command')
  })
  it('a short name that finds something is a search, initials included', () => {
    expect(boxModeOf('trw2', 1)).toBe('search')
    expect(boxModeOf('auth rework', 2)).toBe('search')
  })
  it('two words that find nothing go to the coordinator; one word that finds nothing stays a search', () => {
    expect(boxModeOf('restart billing', 0)).toBe('command')
    expect(boxModeOf('zzz', 0)).toBe('search')
  })
})

const session = (over: Partial<IndexedSession>): IndexedSession => ({
  sessionId: 's1',
  role: 'worker',
  label: 'Trading Worker 2',
  projectName: 'gameful',
  planName: 'Leaderboard API',
  taskTitle: 'Add route',
  jobId: 'j1',
  projectId: 'p1',
  attention: 'idle',
  openGates: 0,
  ...over
})

describe('boxHits', () => {
  const src = {
    sessions: [session({}), session({ sessionId: 's2', label: 'Auth Worker 1', planName: 'Auth rework', jobId: 'j2', attention: 'waiting' })],
    plans: [
      { jobId: 'j1', name: 'Leaderboard API', projectName: 'gameful' },
      { jobId: 'j2', name: 'Auth rework', projectName: 'gameful' }
    ],
    tasks: [{ taskId: 't6', title: 'Rotate tokens', jobId: 'j2', planName: 'Auth rework', projectName: 'gameful' }]
  }
  it('finds sessions, plans and Tasks, each with its project › plan · task line', () => {
    const hits = boxHits(src, 'auth')
    expect(hits.map((h) => [h.kind, h.title, h.where])).toEqual([
      ['session', 'Auth Worker 1', 'gameful › Auth rework · Add route'],
      ['plan', 'Auth rework', 'gameful › Auth rework'],
      ['task', 'Rotate tokens', 'gameful › Auth rework · Rotate tokens']
    ])
    expect(hits[0]).toMatchObject({ waiting: true, sessionId: 's2', jobId: 'j2' })
  })
  it('matches initials', () => {
    expect(boxHits(src, 'trw2').map((h) => h.key)).toEqual(['s:s1'])
    expect(boxHits(src, 'lb').map((h) => h.key)).toEqual(['s:s1', 'p:j1']) // the session works in that plan
  })
  it('offers the help for its name and its words, and only when asked for', () => {
    const help = { title: 'Help', where: 'Topics', words: ['how to', 'f1'] }
    expect(boxHits({ ...src, help }, 'hel').map((h) => h.key)).toEqual(['help'])
    expect(boxHits({ ...src, help }, 'f1').map((h) => h.kind)).toEqual(['help'])
    expect(boxHits({ ...src, help }, 'auth').map((h) => h.kind)).not.toContain('help')
    expect(boxHits(src, 'help')).toEqual([])
  })
  it('nothing typed finds nothing', () => expect(boxHits(src, '')).toEqual([]))
})
