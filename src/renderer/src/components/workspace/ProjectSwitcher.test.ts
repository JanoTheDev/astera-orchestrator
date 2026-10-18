// W6-F: the project switcher at the top of the sidebar.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionInfo } from '../../../../core/types'
import { OTHER_WORKSPACE, type WorkspaceProject } from './workspaceTree'

vi.mock('./workspace.css', () => ({}))
// Attention arrives over IPC after mount; the stand-in answers at once so the dot can be drawn on the server.
vi.mock('./useAttention', () => ({ useAttention: () => ({ w: 'waiting' }) }))
const { ProjectSwitcher } = await import('./ProjectSwitcher')

const tree: WorkspaceProject[] = [
  { id: 'g', name: 'gameful', path: '/repos/gameful', plans: [] },
  { id: 'a', name: 'Astera', path: '/repos/astera', plans: [] }
]
const byWorkspace = new Map([['g', new Set(['w', 'x'])], ['a', new Set<string>()], [OTHER_WORKSPACE, new Set(['o'])]])
const sessions = ['w', 'x', 'o'].map((id) => ({ id, status: 'running' }) as SessionInfo)
const render = (selectedId: string | null): string =>
  renderToStaticMarkup(React.createElement(ProjectSwitcher, { tree, byWorkspace, sessions, selectedId, onSelect: () => {} }))

describe('ProjectSwitcher', () => {
  it('lists each project with its running tabs and its key, a dot on the one waiting, then Other', () => {
    const html = render('g')
    expect(html).toMatch(/aria-pressed="true" title="Ctrl\+Alt\+1"><span class="ws-dot ws-waiting"[^>]*><\/span><span class="ws-name">gameful<\/span><span class="ws-count"[^>]*>2</)
    expect(html).toMatch(/title="Ctrl\+Alt\+2"><span class="ws-name">Astera<\/span><span class="ws-count"[^>]*>0</)
    expect(html).toMatch(/title="Ctrl\+Alt\+3"><span class="ws-name">Other<\/span><span class="ws-count"[^>]*>1</)
    expect(html).toContain('All tabs')
  })
})
