// W9-D: what the Needs you rows offer (InboxPage.tsx NeedCardView), rendered to markup, expanded.
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActionUi } from '../../lib/jobActions'
import type { NeedCard } from './inboxView'
import { t } from '../../../../core/i18n'

vi.mock('./inbox.css', () => ({}))
const { NeedCardView } = await import('./InboxPage')

const card = (over: Partial<NeedCard>): NeedCard => ({ key: 'k', kind: 'approval', at: '2026-10-18T09:00:00Z', jobId: 'j1', projectName: 'gameful', planName: 'L4', ...over })
const render = (c: NeedCard): string =>
  renderToStaticMarkup(
    React.createElement(NeedCardView, {
      c,
      nowMs: Date.parse('2026-10-18T09:12:00Z'),
      open: true,
      door: {} as never,
      ui: {} as ActionUi,
      t: ((k: Parameters<typeof t>[1], p?: Parameters<typeof t>[2]) => t('en', k, p)) as never
    })
  )

describe('NeedCardView read state', () => {
  it('an unread card has no read cue; a read one is dimmed and carries a Read icon', async () => {
    const { markRead, resetBellStore } = await import('./bellStore')
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    resetBellStore()
    expect(render(card({ key: 'u1' }))).not.toContain('needs-row--read')
    markRead('u1')
    const html = render(card({ key: 'u1' }))
    expect(html).toContain('needs-row--read')
    expect(html).toContain('aria-label="Read"')
    vi.unstubAllGlobals()
    resetBellStore()
  })
})

describe('NeedCardView', () => {
  it('collapsed, a row is the toggle and its one action, with no body', () => {
    const html = renderToStaticMarkup(React.createElement(NeedCardView, { c: card({ kind: 'permission', sessionId: 's1' }), nowMs: Date.parse('2026-10-18T09:12:00Z'), door: {} as never, ui: {} as ActionUi, t: ((k: Parameters<typeof t>[1]) => t('en', k)) as never }))
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Answer in its console')
  })

  it('a permission wait offers only "Answer in its console"', () => {
    const html = render(card({ kind: 'permission', sessionId: 's1', taskTitle: 'T1' }))
    expect(html).toContain('Answer in its console')
    expect(html).toContain('gameful › L4 · T1')
    expect(html).toContain('12 min')
    // the row's toggle and its Open action, plus the one body action
    expect(html.match(/<button/g)).toHaveLength(3)
    expect(html).toContain('>Open<')
  })

  it('an approval with an overlap names the files and offers Start after and Move', () => {
    const html = render(
      card({
        sessionId: 'pl1',
        overlaps: [{ taskId: 't1', taskTitle: 'L4', otherJobId: 'j2', otherPlanName: 'Auth rework', otherTaskTitle: 'T6', line: { key: 'inbox.overlap.edit', params: { mine: 'L4', plan: 'Auth rework', theirs: 'T6', path: 'src/api/routes.ts' } } }]
      })
    )
    expect(html).toContain("both edit src/api/routes.ts")
    expect(html).toContain('Start after Auth rework')
    expect(html).toContain('Move L4 into Auth rework')
    for (const w of ['Review plan', 'Talk to planner']) expect(html).toContain(w)
    expect(html).toContain('>Approve<')
  })

  it('once queued after another plan the approval says who waits and drops that Start after', () => {
    const html = render(
      card({
        waitsOn: 'Auth rework',
        overlaps: [{ taskId: 't1', taskTitle: 'L4', otherJobId: 'j2', otherPlanName: 'Auth rework', otherTaskTitle: 'T6', line: { key: 'inbox.overlap.edit', params: {} } }]
      })
    )
    expect(html).toContain('Approve (L4 waits)')
    expect(html).not.toContain('Start after')
  })
})

describe("T4: a worker's request to run an owner-only command", () => {
  it('names the Task and the exact command, and offers Approve and Deny, not an answer box', () => {
    const html = render(
      card({
        kind: 'command',
        taskId: 't1',
        taskTitle: 'T4 · Archive',
        q: { id: 'msg_a', runId: 'r1', taskId: 't1', source: 'approval', question: 'The worker asks to run `astera jobs archive --id j9`. Approve or deny.', command: 'astera jobs archive --id j9', options: ['approve', 'deny'], createdAt: '2026-10-18T09:00:00Z' }
      })
    )
    expect(html).toContain('Worker of T4 · Archive asks to run')
    expect(html).toContain('<code>astera jobs archive --id j9</code>')
    expect(html).toContain('>Approve<')
    expect(html).toContain('>Deny<')
    expect(html).not.toContain('<textarea')
  })
})
