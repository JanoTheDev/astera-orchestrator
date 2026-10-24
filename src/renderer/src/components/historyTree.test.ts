import { describe, it, expect } from 'vitest'
import type { Dispatch, Job, JobRun, Task } from '../../../core/orchestration/types'
import type { HistoryEntry, ProjectSummary } from '../../../core/types'
import { FINISHED_SHOWN, accountChipText, projectRowId, scopeProjects, sessionFactsOf, sessionTreeRows, shortModel } from './historyTree'

const project = (name: string, updatedAt: string): ProjectSummary => ({ accountId: 'a1', projectPath: `/w/${name}`, name, updatedAt })
const entry = (id: string, updatedAt: string): HistoryEntry => ({ id, updatedAt }) as HistoryEntry

describe('sessionTreeRows', () => {
  const projects = [project('old', '2026-08-01T00:00:00Z'), project('new', '2026-09-01T00:00:00Z')]

  it('lists projects newest first', () => {
    const rows = sessionTreeRows(projects, new Set(), () => undefined)
    expect(rows.map((r) => r.id)).toEqual([projectRowId('/w/new'), projectRowId('/w/old')])
  })

  it('puts an expanded project\'s sessions under it, newest first', () => {
    const sessions = [entry('s1', '2026-09-01T01:00:00Z'), entry('s2', '2026-09-01T03:00:00Z')]
    const rows = sessionTreeRows(projects, new Set(['/w/new']), (p) => (p === '/w/new' ? { entries: sessions, total: 2 } : undefined))
    expect(rows.map((r) => r.id)).toEqual([projectRowId('/w/new'), 's2', 's1', projectRowId('/w/old')])
  })

  it('shows a loading row until the first page arrives, and an empty row when there are none', () => {
    const open = new Set(['/w/new'])
    expect(sessionTreeRows(projects, open, () => undefined)[1].kind).toBe('loading')
    expect(sessionTreeRows(projects, open, () => ({ entries: [], total: 0 }))[1].kind).toBe('empty')
  })

  it('draws nothing under a collapsed project', () => {
    expect(sessionTreeRows(projects, new Set(), () => ({ entries: [entry('s1', '2026-09-01T01:00:00Z')], total: 1 }))).toHaveLength(2)
  })

  it('adds a more row for each page not yet fetched, once the older sessions are unfolded', () => {
    const rows = sessionTreeRows(projects, new Set(['/w/new']), () => ({ entries: [entry('s1', '2026-09-01T01:00:00Z')], total: 9 }), true, {
      showOlder: new Set(['/w/new'])
    })
    expect(rows.map((r) => r.id)).toEqual([projectRowId('/w/new'), 's1', 'more:/w/new', 'older:/w/new', projectRowId('/w/old'), 'more:'])
  })
})

describe('sessionTreeRows — live first, older finished folded', () => {
  const projects = [project('old', '2026-08-01T00:00:00Z'), project('new', '2026-09-01T00:00:00Z')]
  const at = (h: number): string => `2026-09-01T${String(h).padStart(2, '0')}:00:00Z`

  it('puts a project with a live session above newer ones, and counts its live sessions', () => {
    const rows = sessionTreeRows(projects, new Set(), () => undefined, false, { liveIn: (p) => (p === '/w/old' ? 2 : 0) })
    expect(rows.map((r) => r.id)).toEqual([projectRowId('/w/old'), projectRowId('/w/new')])
    expect(rows[0]).toMatchObject({ kind: 'project', live: 2 })
  })

  it('lists live sessions first, then the most recent finished ones, then an older row counting the rest', () => {
    const finished = Array.from({ length: FINISHED_SHOWN + 2 }, (_, i) => entry(`f${i}`, at(10 - i)))
    const live = entry('live', at(1))
    const rows = sessionTreeRows(projects, new Set(['/w/new']), (p) => (p === '/w/new' ? { entries: [...finished, live], total: 20 } : undefined), false, {
      statusOf: (e) => (e.id === 'live' ? 'working' : 'finished')
    })
    const ids = rows.map((r) => r.id)
    expect(ids.slice(0, 2 + FINISHED_SHOWN)).toEqual([projectRowId('/w/new'), 'live', ...finished.slice(0, FINISHED_SHOWN).map((e) => e.id)])
    // 20 in all: 1 live and FINISHED_SHOWN finished on screen
    expect(rows[2 + FINISHED_SHOWN]).toEqual({ kind: 'older', id: 'older:/w/new', projectPath: '/w/new', count: 20 - 1 - FINISHED_SHOWN })
    expect(ids).not.toContain('more:/w/new')
  })

  it('shows every loaded session once unfolded, with the more row for pages not yet fetched', () => {
    const finished = Array.from({ length: FINISHED_SHOWN + 2 }, (_, i) => entry(`f${i}`, at(10 - i)))
    const rows = sessionTreeRows(projects, new Set(['/w/new']), (p) => (p === '/w/new' ? { entries: finished, total: 20 } : undefined), false, {
      showOlder: new Set(['/w/new'])
    })
    expect(rows.filter((r) => r.kind === 'session')).toHaveLength(finished.length)
    // the next page, then the row that folds them back
    const own = rows.slice(0, rows.findIndex((r) => r.id === projectRowId('/w/old')))
    expect(own.slice(-2)).toEqual([
      { kind: 'more', id: 'more:/w/new', projectPath: '/w/new' },
      { kind: 'older', id: 'older:/w/new', projectPath: '/w/new', count: 0, open: true }
    ])
  })
})

describe('sessionFactsOf', () => {
  const dispatch = (over: Partial<Dispatch>): Dispatch => ({ id: 'd1', taskId: 't1', provider: 'claude', accountId: 'a1', sessionId: 'app-1', cwd: '/w', specPath: '', startedAt: '2026-09-01T00:00:00Z', workerState: 'ready', ...over }) as Dispatch
  const tasks = [{ id: 't1', runId: 'r1' } as Task]
  const runs = [{ id: 'r1', jobId: 'j1' } as JobRun]
  const jobs = [{ id: 'j1', objective: 'Dark mode' } as Job]
  const base = { sessions: [], attention: {}, dispatches: [], tasks, runs, jobs }

  it('reads a worker transcript live from its Dispatch, with the attention as its state and the plan by name', () => {
    const facts = sessionFactsOf({
      ...base,
      sessions: [{ id: 'app-1', status: 'running' }],
      attention: { 'app-1': 'waiting' },
      dispatches: [dispatch({ nativeSessionId: 'native-1' })]
    })('native-1')
    expect(facts.status).toBe('needs')
    expect(facts.jobId).toBe('j1')
    expect(facts.planName).toBe('Dark mode')
  })

  it('reads a resumed session live through resumeSessionId, idle without attention', () => {
    const factsOf = sessionFactsOf({ ...base, sessions: [{ id: 'app-2', status: 'running', resumeSessionId: 'native-2' }], attention: { 'app-2': 'working' } })
    expect(factsOf('native-2')).toEqual({ status: 'working' })
    expect(sessionFactsOf({ ...base, sessions: [{ id: 'app-2', status: 'running', resumeSessionId: 'native-2' }] })('native-2').status).toBe('idle')
  })

  it('reads an ended Dispatch failed or finished by its outcome, and an unknown transcript finished', () => {
    const exited = [{ id: 'app-1', status: 'exited' as const }]
    expect(sessionFactsOf({ ...base, sessions: exited, dispatches: [dispatch({ nativeSessionId: 'n', outcome: 'failed' })] })('n').status).toBe('failed')
    expect(sessionFactsOf({ ...base, sessions: exited, dispatches: [dispatch({ nativeSessionId: 'n', outcome: 'succeeded' })] })('n').status).toBe('finished')
    expect(sessionFactsOf(base)('nobody')).toEqual({ status: 'finished' })
  })
})

describe('shortModel', () => {
  it('names a Claude model by its family and leaves other ids alone', () => {
    expect(shortModel('claude-opus-5-5')).toBe('opus')
    expect(shortModel('claude-sonnet-4-5-20250929')).toBe('sonnet')
    expect(shortModel('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022')
    expect(shortModel('gpt-5.5-codex')).toBe('gpt-5.5-codex')
    expect(shortModel(undefined)).toBeUndefined()
  })
})

describe('accountChipText', () => {
  it("keeps an email's name part and any other label whole", () => {
    expect(accountChipText('work@example.com')).toBe('work')
    expect(accountChipText('jip-claude0')).toBe('jip-claude0')
    expect(accountChipText('@odd')).toBe('@odd')
  })
})

describe('scopeProjects', () => {
  const projects = [project('a', '2026-08-01T00:00:00Z'), project('b', '2026-09-01T00:00:00Z'), project('c', '2026-09-02T00:00:00Z')]
  const owner = (path: string): string | null => (path === '/w/a' || path === '/w/c' ? 'p1' : path === '/w/b' ? 'p2' : null)

  it('keeps everything for All projects (null scope)', () => {
    expect(scopeProjects(projects, null, owner)).toEqual(projects)
  })

  it('keeps only the folders the picked project owns', () => {
    expect(scopeProjects(projects, 'p1', owner).map((p) => p.name)).toEqual(['a', 'c'])
  })

  it('matches nothing for a scope no project holds, and drops folders of no project', () => {
    expect(scopeProjects(projects, '', owner)).toEqual([])
    expect(scopeProjects([project('x', '2026-09-01T00:00:00Z')], 'p1', owner)).toEqual([])
  })
})
