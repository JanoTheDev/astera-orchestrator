// W6-E progress view: the board by wave and the files tab, drawn to markup (the suite runs in node, so no clicks: the
// click targets are checked by what they carry). T8: the steps are a vertical list of Task rows; a row's detail shows
// when it is expanded (`selected`), and the open questions are Needs you's.
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { JobTask } from '../../../../core/types'
import { NeedsYou, TaskBoard } from './TaskBoard'
import { needsYouOf } from './planBoard'
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
    expect(html).toContain('plan.steps.title(n=1)')
    expect(html).toContain('plan.wave.progress(done=1,total=1)')
    // Wave 2 is the first not done
    expect(html.match(/<section class="plan-wave plan-wave-current"[^>]*>.*?<\/h3>/)?.[0]).toContain('plan.steps.title(n=2)')
    expect(html).not.toContain('plan-wave-banner')
    // W12: a finished step folds behind a ui Button that says it is folded
    expect(html).toMatch(/class="ui-btn[^"]*plan-wave-fold"[^>]*aria-expanded="false"/)
  })
  it("W12: a card's branch says what a worktree is, in its expanded detail", () => {
    expect(board({ tasks: [task('w', { branch: 'feat/x' })], layers: [['w']], selected: 'w' })).toContain('plan.steps.worktreeHint')
    expect(board({ tasks: [task('w', { branch: 'feat/x' })], layers: [['w']] })).not.toContain('plan.steps.worktreeHint')
  })
  it('T8: each step is a vertical list of rows, each with its anchor; a folded step opens for its expanded Task', () => {
    const html = board({ selected: 'a' })
    expect(html.match(/<ul class="plan-wave-cards">/g)).toHaveLength(3)
    expect(html).toContain('id="plan-task-a"')
    expect(html).toMatch(/aria-expanded="true"[^>]*aria-label="plan.row.collapse\(task=T-a\)"/)
    expect(board()).not.toContain('id="plan-task-a"') // step 1 is done, so folded
  })
  it('shows a replan in progress as a banner on the current wave', () => {
    expect(board({ replanning: true })).toContain('plan.steps.replanning(n=2)')
  })
  it("lists a card's files, three and then +N more", () => {
    const html = board({ selected: 'b' })
    expect(html).toContain('src/c.ts')
    expect(html).not.toContain('src/d.ts')
    expect(html).toContain('plan.card.moreFiles(n=2)')
  })
  it("says what a running worker is doing, and how many questions the coordinator answered", () => {
    expect(board()).toContain('plan.now.permission')
    expect(board({ selected: 'b' })).toContain('plan.card.answers(n=2)')
  })
  it('T2: an expanded row opens with what renderAbout draws, before its existing detail', () => {
    const html = board({ selected: 'b', renderAbout: (tk) => React.createElement('p', { className: 'about' }, `about ${tk.id}`), renderDetail: () => 'DETAIL' })
    expect(html).toContain('about b')
    expect(html.indexOf('about b')).toBeLessThan(html.indexOf('plan.card.model'))
    expect(html.indexOf('plan.card.model')).toBeLessThan(html.indexOf('DETAIL'))
    expect(board({ renderAbout: () => 'ABOUT' })).not.toContain('ABOUT')
  })
  it('a running row whose tab is open links to its console', () => {
    expect(board()).toContain('plan.row.openConsole')
    expect(board({ canOpenSession: () => false })).not.toContain('plan.row.openConsole')
  })
})

describe('Continue / Retry on a row', () => {
  const stuck = [task('h', { status: 'blocked' }), task('g', { status: 'blocked', gate: { id: 'g1', question: 'q' } }), task('f', { status: 'failed' })]
  const html = board({ tasks: stuck, layers: [['h', 'g', 'f']], onRestart: () => {} })
  it('shows Continue on the gate-less blocked Task, Retry on the failed one, nothing on the Gate one', () => {
    expect(html.match(/plan\.task\.continue/g)).toHaveLength(1)
    expect(html.match(/plan\.task\.retry/g)).toHaveLength(1)
  })
  it('shows no button without onRestart', () => {
    expect(board({ tasks: stuck, layers: [['h', 'g', 'f']] })).not.toContain('plan-row-action')
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

describe('Needs you: coordinator Gates (W8-F, #97)', () => {
  const gated = task('g', {
    status: 'blocked',
    openGates: 1,
    gate: { id: 'gat_1', question: 'Out of tries: Task g', options: ['retry-once', 'mark-failed'], kind: 'convergence-exhausted' }
  })
  const needs = (tk: JobTask): string =>
    renderToStaticMarkup(React.createElement(NeedsYou, { items: needsYouOf([tk], []), onAnswer: async () => null, onShowTask: () => {} }))
  it("a Task's open Gate gets the answer box under its name: its options as buttons and a text box", () => {
    const html = needs(gated)
    expect(html).toContain('plan-question')
    expect(html).toContain('T-g')
    expect(html).toContain('Out of tries: Task g')
    expect(html).toMatch(/<(?:button)[^>]*>(<span[^>]*>)?retry-once(<\/span>)?<\/button>/)
    expect(html).toMatch(/<(?:button)[^>]*>(<span[^>]*>)?mark-failed(<\/span>)?<\/button>/)
    expect(html).toContain('<textarea')
  })
  it('a check that could not be made has its buttons and no text box', () => {
    const html = needs(task('g', { status: 'blocked', openGates: 1, gate: { id: 'gat_2', question: 'q', options: ['retry', 'skip-check'], kind: 'check-unavailable' } }))
    expect(html).toMatch(/<(?:button)[^>]*>(<span[^>]*>)?skip-check(<\/span>)?<\/button>/)
    expect(html).not.toContain('<textarea')
  })
  it('nothing when nothing is open, and the board itself has no answer box', () => {
    expect(needs(task('x'))).toBe('')
    expect(board({ tasks: [gated], layers: [['g']] })).not.toContain('plan-question')
  })
})

describe('TaskBoard windowing', () => {
  const many = (n: number): JobTask[] => Array.from({ length: n }, (_, i) => task(`m${i}`))
  const rowsOf = (html: string): number => html.match(/<li id="plan-task-/g)?.length ?? 0

  it('draws far fewer than 600 Task rows for a 600-Task board', () => {
    const rows = rowsOf(board({ tasks: many(600), layers: [many(600).map((x) => x.id)] }))
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThan(60)
  })
  it('draws far fewer than 600 rows when the Tasks are split into 20 steps of 30', () => {
    const all = many(600)
    const layers = Array.from({ length: 20 }, (_, i) => all.slice(i * 30, i * 30 + 30).map((x) => x.id))
    const rows = rowsOf(board({ tasks: all, layers }))
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThan(80)
  })
  it('draws every row of a small board', () => {
    expect(rowsOf(board({ tasks: many(10), layers: [many(10).map((x) => x.id)] }))).toBe(10)
  })
})
