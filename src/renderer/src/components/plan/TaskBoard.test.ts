// W6-E progress view: the board by wave and the files tab, drawn to markup (the suite runs in node, so no clicks: the
// click targets are checked by what they carry).
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { JobTask } from '../../../../core/types'
import { TaskBoard } from './TaskBoard'
import { PlanFiles } from './PlanFiles'

vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'en', t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(',')})` : key) })
}))

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: `T-${id}`, status: 'pending', openGates: 0, ...over })
const tasks: JobTask[] = [
  task('a', { status: 'completed', affectedPaths: ['src/a.ts'] }),
  task('b', {
    status: 'dispatched',
    startedAt: '2026-10-18T09:00:00Z',
    sessionId: 'ses-b',
    affectedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']
  }),
  task('c')
]
const layers = [['a'], ['b'], ['c']]
const answered = { id: 'x', sequence: 1, occurredAt: '2026-10-18T09:30:00Z', type: 'question.auto-answered', runId: 'r1', taskId: 'b', payload: { title: 'T-b', question: 'Use v2?', answer: 'Yes' } } as unknown as ActivityEvent

const board = (over: Partial<React.ComponentProps<typeof TaskBoard>> = {}): string =>
  renderToStaticMarkup(
    React.createElement(TaskBoard, {
      tasks,
      accounts: null,
      selected: undefined,
      onSelect: () => {},
      layers,
      activity: [answered, { ...answered, id: 'y' }],
      sessions: { 'ses-b': { prompt: 'permission' } },
      canOpenSession: (id) => id === 'ses-b',
      onOpenSession: () => {},
      ...over
    })
  )

describe('TaskBoard by wave', () => {
  it('draws one section per wave with its progress, and marks the current one', () => {
    const html = board()
    expect(html.match(/class="plan-wave[ "]/g)).toHaveLength(3)
    expect(html).toContain('plan.wave.title(n=1)')
    expect(html).toContain('plan.wave.progress(done=1,total=1)')
    // Wave 2 is the first not done
    expect(html.match(/<section class="plan-wave plan-wave-current"[^>]*>.*?<\/h3>/)?.[0]).toContain('plan.wave.title(n=2)')
    expect(html).not.toContain('plan-wave-banner')
  })
  it('shows a replan in progress as a banner on the current wave', () => {
    expect(board({ replanning: true })).toContain('plan.wave.replanning(n=2)')
  })
  it("lists a card's files, three and then +N more", () => {
    const html = board()
    expect(html).toContain('src/c.ts')
    expect(html).not.toContain('src/d.ts')
    expect(html).toContain('plan.card.moreFiles(n=2)')
  })
  it("says what a running worker is doing, and how many questions the coordinator answered", () => {
    const html = board()
    expect(html).toContain('plan.now.permission')
    expect(html).toContain('plan.card.answers(n=2)')
  })
  it('a running card whose tab is open goes to that tab; without one it selects', () => {
    expect(board()).toContain('title="plan.card.focus"')
    expect(board({ canOpenSession: () => false })).not.toContain('plan.card.focus')
  })
})

describe('PlanFiles', () => {
  it('lists every path with its Tasks, and marks a path two Tasks share', () => {
    const html = renderToStaticMarkup(React.createElement(PlanFiles, { tasks, onOpenPath: () => {}, onSelect: () => {} }))
    expect(html.match(/<li class="plan-file plan-file-overlap"[^>]*>.*?<\/li>/)?.[0]).toContain('src/a.ts')
    expect(html).toContain('plan.files.overlap(n=2)')
    expect(html).toContain('src/e.ts')
    expect(html).toContain('title="plan.files.open"')
  })
})
