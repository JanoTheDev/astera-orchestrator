// W9-D: what the cards offer (InboxPage.tsx NeedCardView), rendered to markup.
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActionUi } from '../../lib/jobActions'
import type { NeedCard } from './inboxView'

vi.mock('./inbox.css', () => ({}))
const { NeedCardView } = await import('./InboxPage')

const card = (over: Partial<NeedCard>): NeedCard => ({ key: 'k', kind: 'approval', at: '2026-10-18T09:00:00Z', jobId: 'j1', projectName: 'gameful', planName: 'L4', ...over })
const render = (c: NeedCard): string =>
  renderToStaticMarkup(
    React.createElement(NeedCardView, {
      c,
      nowMs: Date.parse('2026-10-18T09:12:00Z'),
      door: {} as never,
      ui: {} as ActionUi,
      t: ((k: string) => k) as never
    })
  )

describe('NeedCardView', () => {
  it('a permission wait offers only "Answer in its console"', () => {
    const html = render(card({ kind: 'permission', sessionId: 's1', taskTitle: 'T1' }))
    expect(html).toContain('Answer in its console')
    expect(html).toContain('gameful › L4 · T1')
    expect(html).toContain('12 min')
    expect(html.match(/<button/g)).toHaveLength(1)
  })

  it('an approval with an overlap names the files and offers Start after and Move', () => {
    const html = render(
      card({
        sessionId: 'pl1',
        overlaps: [{ taskId: 't1', taskTitle: 'L4', otherJobId: 'j2', otherPlanName: 'Auth rework', otherTaskTitle: 'T6', line: "L4 and Auth rework's T6 both edit src/api/routes.ts" }]
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
        overlaps: [{ taskId: 't1', taskTitle: 'L4', otherJobId: 'j2', otherPlanName: 'Auth rework', otherTaskTitle: 'T6', line: 'x' }]
      })
    )
    expect(html).toContain('Approve (L4 waits)')
    expect(html).not.toContain('Start after')
  })
})
