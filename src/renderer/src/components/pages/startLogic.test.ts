import { describe, it, expect } from 'vitest'
import {
  accountPickOptions, afterCreate, blockedReason, consolesIn, defaultMode, dropOpensStart, filesFromDrop, handsOffSaveArgs, intakeTab, lookupArgs, optionsSummary, primaryLabel, promptCount,
  livePlans, priorityPresetOf, priorityValueOf, shouldLandOnStart, type PlanRow
} from './startLogic'
import type { Account } from '../../../../core/types'

const t = (key: string, params?: Record<string, string | number>): string => (params ? `${key}:${JSON.stringify(params)}` : key)

describe('Start mode default', () => {
  it('prompt files attached → Run as written', () => {
    expect(defaultMode({ files: ['/p/a.md', '/p/b.md'], text: '' })).toBe('prompts')
  })
  it('text only → Plan it for me', () => {
    expect(defaultMode({ files: [], text: 'add dark mode' })).toBe('plan')
  })
  it('a PDF or an image alone is material for the planner', () => {
    expect(defaultMode({ files: ['/p/spec.pdf', '/p/shot.png'], text: '' })).toBe('plan')
  })
  it("the owner's pick wins", () => {
    expect(defaultMode({ files: ['/p/a.md'], text: '', chosen: 'plan' })).toBe('plan')
    expect(defaultMode({ files: [], text: 'x', chosen: 'prompts' })).toBe('prompts')
  })
})

describe('intakeTab', () => {
  it('maps the composer onto one W6-A intake tab', () => {
    expect(intakeTab({ mode: 'prompts', files: [] })).toBe('prompts')
    expect(intakeTab({ mode: 'plan', files: ['/a.pdf'] })).toBe('files')
    expect(intakeTab({ mode: 'plan', files: [] })).toBe('describe')
  })
})

describe('primaryLabel', () => {
  it('says what happens', () => {
    expect(primaryLabel({ mode: 'plan', files: [], text: 'x' }, t)).toEqual({ label: 'start.go.plan' })
    expect(primaryLabel({ mode: 'prompts', files: ['/a.md', '/b.md', '/c.md'], text: '' }, t)).toEqual({
      label: 'start.go.consoles:{"n":3}',
      note: 'start.go.filesNote:{"n":3}'
    })
    expect(primaryLabel({ mode: 'prompts', files: [], text: '## one\nx\n## two\n' }, t).note).toBe('start.go.sectionsNote:{"n":2}')
    expect(primaryLabel({ mode: 'plan', files: [], text: 'x', after: 'Auth' }, t)).toEqual({ label: 'start.go.queue:{"plan":"Auth"}' })
  })
  it('counts prompts', () => {
    expect(promptCount(['/a.md', '/b.pdf'], '')).toBe(1)
    expect(promptCount([], 'one document, no sections')).toBe(1)
    expect(promptCount([], '  ')).toBe(0)
  })
})

describe('empty-project landing', () => {
  it('no plans and no consoles → Start', () => {
    expect(shouldLandOnStart({ plans: 0, consoles: 0 })).toBe(true)
    expect(shouldLandOnStart({ plans: 1, consoles: 0 })).toBe(false)
    expect(shouldLandOnStart({ plans: 0, consoles: 1 })).toBe(false)
  })
  it('counts the consoles in the project folder, not a sibling', () => {
    const s = [{ cwd: '/w/app' }, { cwd: '/w/app/pkg' }, { cwd: '/w/app-two' }, { cwd: 'C:\\W\\App\\x' }]
    expect(consolesIn(s, '/w/app/')).toBe(2)
    expect(consolesIn(s, 'c:/w/app', true)).toBe(1)
  })
})

describe('drop to attach', () => {
  const pathFor = (f: { name: string }): string => (f.name === 'nopath.md' ? '' : `/d/${f.name}`)
  it('takes the files Start can attach', () => {
    const list = [{ name: 'a.md' }, { name: 'b.PDF' }, { name: 'c.zip' }, { name: 'shot.png' }, { name: 'nopath.md' }]
    expect(filesFromDrop(list, pathFor as never)).toEqual(['/d/a.md', '/d/b.PDF', '/d/shot.png'])
    expect(filesFromDrop(null, pathFor as never)).toEqual([])
  })
  it('opens Start only for a drop nothing else took', () => {
    expect(dropOpensStart({ defaultPrevented: false, files: ['/d/a.md'] })).toBe(true)
    expect(dropOpensStart({ defaultPrevented: true, files: ['/d/a.md'] })).toBe(false)
    expect(dropOpensStart({ defaultPrevented: false, files: [] })).toBe(false)
  })
})

// W10-A Run as written by name
describe('Run as written by name', () => {
  it('the button counts the files the typed names resolved to', () => {
    expect(primaryLabel({ mode: 'prompts', files: [], text: 'run W8-A, B', named: 2 }, t)).toEqual({
      label: 'start.go.consoles:{"n":2}',
      note: 'start.go.namesNote:{"n":2}'
    })
  })
  it('the dry run: Run as written with text only, attached .md files sent along for the notice', () => {
    expect(lookupArgs({ mode: 'plan', files: [], text: 'W8-A', cwd: '/r' })).toBeNull()
    expect(lookupArgs({ mode: 'prompts', files: [], text: ' ', cwd: '/r' })).toBeNull()
    expect(lookupArgs({ mode: 'prompts', files: ['/x/a.md', '/x/b.pdf'], text: 'next waves', cwd: '/r' })).toEqual({
      cwd: '/r',
      mode: 'prompts',
      objective: 'next waves',
      dryRun: true,
      attach: ['/x/a.md']
    })
  })
})

// T2
describe('sticky hands-off and More options', () => {
  it('saves Hands-off as the project default', () => {
    expect(handsOffSaveArgs('p1', true)).toEqual({ id: 'p1', handsOff: 'on' })
    expect(handsOffSaveArgs('p1', false)).toEqual({ id: 'p1', handsOff: 'off' })
  })
  it('sums up the folded options on one line', () => {
    expect(optionsSummary({ concurrency: 3, delivery: 'pr', approval: 'ask', priority: 0 }, t)).toBe(
      'start.more.consoles:{"n":3} · start.more.pr · start.more.ask'
    )
    expect(optionsSummary({ concurrency: 1, delivery: 'push', approval: 'auto', priority: 1 }, t)).toBe(
      'start.more.consoles:{"n":1} · start.more.push · start.more.auto · start.priority.high'
    )
    expect(optionsSummary({ concurrency: 1, delivery: 'pr', approval: 'auto', priority: 0, handsOff: true, after: 'L4' }, t)).toBe(
      'start.opt.handsOff · start.opt.after:{"plan":"L4"} · start.more.consoles:{"n":1} · start.more.pr · start.more.auto'
    )
  })
  it('says why Create is off: the project first, then the text', () => {
    expect(blockedReason({ project: false, request: false }, t)).toBe('start.project.required')
    expect(blockedReason({ project: true, request: false }, t)).toBe('start.needText')
    expect(blockedReason({ project: true, request: true }, t)).toBeNull()
  })
})

// T4
describe('planning and priority presets', () => {
  it('maps low/normal/high onto -1/0/1 and back', () => {
    expect([priorityValueOf('low'), priorityValueOf('normal'), priorityValueOf('high')]).toEqual([-1, 0, 1])
    expect([-3, -1, 0, 1, 4].map(priorityPresetOf)).toEqual(['low', 'low', 'normal', 'high', 'high'])
  })
  it("opens the planner's terminal when it started; a queued plan goes to the agents list", () => {
    expect(afterCreate('ses_1')).toEqual({ openConsole: 'ses_1' })
    expect(afterCreate(undefined)).toEqual({ openPage: 'agents' })
  })
})

describe('Start after', () => {
  const row = (id: string, over: Partial<PlanRow>): PlanRow => ({ id, objective: id, cwd: '/r', createdAt: 'x', ...over })
  it('lists queued, planning, waiting, running and held plans with their state', () => {
    const rows = [
      row('q', { pendingStart: true, after: 'r', outcome: 'pending' }),
      row('p', { pendingStart: true, outcome: 'pending' }),
      row('w', { outcome: 'running', questionsOpen: 1 }),
      row('r', { outcome: 'running' }),
      row('h', { outcome: 'paused' })
    ]
    expect(livePlans(rows).map((p) => [p.id, p.state])).toEqual([['q', 'queued'], ['p', 'planning'], ['w', 'waiting'], ['r', 'running'], ['h', 'held']])
  })
  it('leaves out completed, failed, scheduled and archived plans', () => {
    const rows = [row('c', { outcome: 'completed' }), row('f', { outcome: 'failed' }), row('a', { outcome: 'running', archivedAt: 'x' }), row('s', { outcome: 'running', schedule: {} as never })]
    expect(livePlans(rows)).toEqual([])
  })
})

describe('account picker (T5b)', () => {
  const acc = (id: string, provider?: 'codex'): Account => ({ id, label: id.toUpperCase(), configDir: `/c/${id}`, color: '', createdAt: '', provider })
  it('Auto first, then each signed-in Claude account with its weekly and 5h used percent', () => {
    const usage = { '/c/a': { weekly: { usedPercent: 40, resetsAt: null }, session: null, readAt: '', remembered: false } }
    expect(accountPickOptions([acc('a'), acc('b'), acc('c'), acc('x', 'codex')], new Set(['a', 'b', 'x']), usage, t)).toEqual([
      { value: 'auto', label: 'accounts.auto' },
      { value: 'a', label: 'accounts.pickUsage:{"name":"A","weekly":"40%","session":"—"}' },
      { value: 'b', label: 'accounts.pickUsage:{"name":"B","weekly":"—","session":"—"}' }
    ])
  })
})
