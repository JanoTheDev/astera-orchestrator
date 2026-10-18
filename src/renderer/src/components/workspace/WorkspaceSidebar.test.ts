import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionInfo } from '../../../../core/types'
import type { WorkspaceData, WorkspaceProject } from './workspaceTree'

vi.mock('./workspace.css', () => ({}))
vi.mock('../search/search.css', () => ({}))
const { WorkspaceSidebar, sessionStatusOf } = await import('./WorkspaceSidebar')

const tree: WorkspaceProject[] = [
  {
    id: 'p1', name: 'Gameful', path: '/repos/gameful',
    plans: [
      {
        jobId: 'j1', projectId: 'p1', name: 'Trading', archived: false, paused: true, runId: 'r1', planner: [],
        coordinator: [{ sessionId: 'c', role: 'coordinator', label: 'Trading Coordinator', projectName: 'Gameful', planName: 'Trading' }],
        workers: [{ sessionId: 'w', role: 'worker', label: 'Trading Worker 1', projectName: 'Gameful', planName: 'Trading', taskTitle: 'Split the book' }]
      },
      { jobId: 'j2', projectId: 'p1', name: 'Redis perf', archived: true, paused: false, planner: [], coordinator: [], workers: [] }
    ]
  }
]

const render = (selectedPlanId: string | null, data: WorkspaceData | null = null): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceSidebar, {
      tree, data, sessions: [{ id: 'w', status: 'running' } as SessionInfo], showArchived: true, onShowArchived: () => {},
      selectedPlanId, onSelectPlan: () => {}, canOpenSession: (id) => id === 'w', onOpenSession: () => {}
    })
  )

describe('WorkspaceSidebar', () => {
  it('draws Project → Plan → grouped sessions, with tags and only openable sessions enabled', () => {
    const html = render(null)
    for (const text of ['Gameful', 'Trading', 'Redis perf', 'Coordinator', 'Workers', 'Trading Worker 1', 'Split the book', 'paused', 'archived', 'No sessions'])
      expect(html).toContain(text)
    expect(html).not.toContain('Planner')
    expect(html).not.toContain('All sessions')
    // the coordinator's session has no tab, so its row cannot be clicked
    expect(html).toMatch(/<button class="ws-row ws-session" disabled=""[^>]*><span class="ws-dot ws-not-open"[^>]*><\/span><span class="ws-name">Trading Coordinator/)
  })

  it('marks the open plan and offers the way back to every session', () => {
    const html = render('j1')
    expect(html).toContain('ws-plan selected')
    expect(html).toContain('All sessions')
  })

  // W3-C
  it('counts what needs input in the header badge (the search is the command box, W9-D)', () => {
    expect(render(null)).toMatch(/class="ss-badge"[^>]*>0</)
    expect(render(null)).not.toContain('Search sessions across projects')
    const awaiting: WorkspaceData = {
      projects: [], runs: [], tasks: [], dispatches: [], gates: [],
      jobsByProject: { p1: [{ id: 'j1', objective: 'o', cwd: '/x', createdAt: '', pendingStart: true, plannerSessionIds: [] }] }
    }
    expect(render(null, awaiting)).toMatch(/class="ss-badge ss-due"[^>]*>1</)
  })

  it('reads a session’s status from its process first, then its attention', () => {
    expect(sessionStatusOf(undefined, 'working')).toBe('not open')
    expect(sessionStatusOf({ status: 'exited' } as SessionInfo, 'working')).toBe('exited')
    expect(sessionStatusOf({ status: 'running' } as SessionInfo, 'waiting')).toBe('waiting')
    expect(sessionStatusOf({ status: 'running' } as SessionInfo, undefined)).toBe('idle')
  })
})
