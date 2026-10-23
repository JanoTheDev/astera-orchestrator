import { describe, expect, it } from 'vitest'
import type { HistoryEntry, ProjectSummary } from '../../../../core/types'
import { sessionRows } from './historyRows'

const project = (name: string, updatedAt: string): ProjectSummary => ({ accountId: 'a1', projectPath: `/w/${name}`, name, updatedAt })
const entry = (id: string, projectPath: string, updatedAt: string): HistoryEntry => ({
  id: `a1:${id}`, accountId: 'a1', sessionId: id, projectPath, title: id, updatedAt, filePath: `/f/${id}`, awaitingReply: false, rootUuid: null
})
const kinds = (rows: ReturnType<typeof sessionRows>): string[] => rows.map((r) => r.kind)

describe('sessionRows', () => {
  const projects = [project('old', '2026-01-01T00:00:00Z'), project('new', '2026-03-01T00:00:00Z')]

  it('lists projects newest first and shows no sessions while collapsed', () => {
    const rows = sessionRows(projects, {}, new Set(), false)
    expect(rows.map((r) => r.kind === 'project' && r.project.name)).toEqual(['new', 'old'])
  })

  it('puts an expanded project\'s sessions under it, newest first', () => {
    const slices = {
      '/w/new': { entries: [entry('s1', '/w/new', '2026-03-01T01:00:00Z'), entry('s2', '/w/new', '2026-03-01T02:00:00Z')], total: 2, loaded: true }
    }
    const rows = sessionRows(projects, slices, new Set(['/w/new']), false)
    expect(kinds(rows)).toEqual(['project', 'session', 'session', 'project'])
    expect(rows.filter((r) => r.kind === 'session').map((r) => r.kind === 'session' && r.entry.sessionId)).toEqual(['s2', 's1'])
  })

  it('shows a loading row, not "none", before the first page arrives', () => {
    const rows = sessionRows(projects, {}, new Set(['/w/new']), false)
    expect(kinds(rows)).toEqual(['project', 'loading', 'project'])
  })

  it('shows "none" for a project that loaded with no sessions', () => {
    const rows = sessionRows(projects, { '/w/new': { entries: [], total: 0, loaded: true } }, new Set(['/w/new']), false)
    expect(kinds(rows)).toEqual(['project', 'empty', 'project'])
  })

  it('offers more sessions and more projects while the totals say there are more', () => {
    const slices = { '/w/new': { entries: [entry('s1', '/w/new', '2026-03-01T01:00:00Z')], total: 5, loaded: true } }
    const rows = sessionRows(projects, slices, new Set(['/w/new']), true)
    expect(kinds(rows)).toEqual(['project', 'session', 'more', 'project', 'more'])
  })
})
