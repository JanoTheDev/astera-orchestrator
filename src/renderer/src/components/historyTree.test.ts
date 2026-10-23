import { describe, it, expect } from 'vitest'
import type { HistoryEntry, ProjectSummary } from '../../../core/types'
import { projectRowId, sessionTreeRows } from './historyTree'

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

  it('adds a more row for each page not yet fetched', () => {
    const rows = sessionTreeRows(projects, new Set(['/w/new']), () => ({ entries: [entry('s1', '2026-09-01T01:00:00Z')], total: 9 }), true)
    expect(rows.map((r) => r.id)).toEqual([projectRowId('/w/new'), 's1', 'more:/w/new', projectRowId('/w/old'), 'more:'])
  })
})
