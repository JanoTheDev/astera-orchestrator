import { describe, it, expect, vi } from 'vitest'
import {
  accountPickOptions, afterCreate, blockedReason, consolesIn, dropOpensStart, filesFromDrop, handsOffSaveArgs, intakeTab, isSubmitKey, lastMode, lookupArgs, planningOf, primaryLabel,
  projectOptions, promptCount, saveMode, scheduledArgs, STARTERS, STARTER_MODE, livePlans, shouldLandOnStart, withStarter, type PlanRow
} from './startLogic'
import type { Account } from '../../../../core/types'

const t = (key: string, params?: Record<string, string | number>): string => (params ? `${key}:${JSON.stringify(params)}` : key)

describe('intakeTab', () => {
  it('maps the composer onto one W6-A intake tab', () => {
    expect(intakeTab({ mode: 'prompts', files: [] })).toBe('prompts')
    expect(intakeTab({ mode: 'chat', files: ['/a.pdf'] })).toBe('files')
    expect(intakeTab({ mode: 'auto', files: [] })).toBe('describe')
  })
})

describe('primaryLabel', () => {
  it('says what happens', () => {
    expect(primaryLabel({ mode: 'chat', files: [], text: 'x' }, t)).toEqual({ label: 'start.go.plan' })
    expect(primaryLabel({ mode: 'auto', files: [], text: 'x' }, t)).toEqual({ label: 'start.go.auto' })
    expect(primaryLabel({ mode: 'prompts', files: ['/a.md', '/b.md', '/c.md'], text: '' }, t)).toEqual({
      label: 'start.go.prompts',
      note: 'start.go.filesNote:{"n":3}'
    })
    expect(primaryLabel({ mode: 'prompts', files: [], text: '## one\nx\n## two\n' }, t).note).toBe('start.go.sectionsNote:{"n":2}')
    expect(primaryLabel({ mode: 'chat', files: [], text: 'x', after: 'Auth' }, t)).toEqual({ label: 'start.go.queue:{"plan":"Auth"}' })
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
      label: 'start.go.prompts',
      note: 'start.go.namesNote:{"n":2}'
    })
  })
  it('the dry run: Run as written with text only, attached .md files sent along for the notice', () => {
    expect(lookupArgs({ mode: 'chat', files: [], text: 'W8-A', cwd: '/r' })).toBeNull()
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
describe('sticky hands-off', () => {
  it('saves Hands-off as the project default', () => {
    expect(handsOffSaveArgs('p1', true)).toEqual({ id: 'p1', handsOff: 'on' })
    expect(handsOffSaveArgs('p1', false)).toEqual({ id: 'p1', handsOff: 'off' })
  })
})

// T14
describe('the primary button', () => {
  it('is off with a reason until a project and text exist', () => {
    expect(blockedReason({ project: false, text: false, request: false }, t)).toBe('start.project.required')
    expect(blockedReason({ project: false, text: true, request: false }, t)).toBe('start.project.required')
    expect(blockedReason({ project: true, text: false, request: true }, t)).toBe('start.needText')
    expect(blockedReason({ project: true, text: true, request: false }, t)).toBe('start.needText')
    expect(blockedReason({ project: true, text: true, request: true }, t)).toBeNull()
  })
  it('Ctrl+Enter (or Cmd+Enter) submits, Enter alone is a newline', () => {
    expect(isSubmitKey({ key: 'Enter', ctrlKey: true, metaKey: false })).toBe(true)
    expect(isSubmitKey({ key: 'Enter', ctrlKey: false, metaKey: true })).toBe(true)
    expect(isSubmitKey({ key: 'Enter', ctrlKey: false, metaKey: false })).toBe(false)
    expect(isSubmitKey({ key: 'a', ctrlKey: true, metaKey: false })).toBe(false)
  })
})

describe('the project picker', () => {
  const projects = [{ name: 'App', path: '/w/app' }, { name: 'Api', path: '/w/api' }]
  it('lists projects only, never "All projects"; a placeholder shows while none is chosen', () => {
    expect(projectOptions(projects, '', 'Choose')).toEqual([{ value: '', label: 'Choose' }, { value: '/w/app', label: 'App' }, { value: '/w/api', label: 'Api' }])
    expect(projectOptions(projects, '/w/app', 'Choose').map((o) => o.value)).toEqual(['/w/app', '/w/api'])
    for (const chosen of ['', '/w/app']) expect(projectOptions(projects, chosen, 'Choose').some((o) => /all/i.test(o.value))).toBe(false)
  })
})

describe('starter chips', () => {
  it('are the five from the brief; each but the issue picker fills the box and sets the mode', () => {
    expect(STARTERS.map((s) => s.id)).toEqual(['fix', 'build', 'audit', 'issues', 'file'])
    expect(STARTERS.filter((s) => s.text).map((s) => s.id)).toEqual(['fix', 'build', 'audit', 'file'])
    expect(STARTER_MODE).toBe('chat')
  })
  it('fill an empty box or another template, and go below what the person already wrote', () => {
    const all = ['Fix these bugs:\n- ', 'Build this feature: ']
    expect(withStarter('', 'Build this feature: ', all)).toBe('Build this feature: ')
    expect(withStarter('Fix these bugs:\n-', 'Build this feature: ', all)).toBe('Build this feature: ')
    expect(withStarter('make it faster', 'Build this feature: ', all)).toBe('make it faster\n\nBuild this feature: ')
  })
  it('the three modes plan with me, alone, or not at all', () => {
    expect([planningOf('chat'), planningOf('auto'), planningOf('prompts')]).toEqual(['chat', 'auto', 'auto'])
  })
})

describe('the last choice of a project', () => {
  const store = new Map<string, string>()
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
  it('is remembered per project, and ignored when storage fails or holds nonsense', () => {
    vi.stubGlobal('window', { localStorage: ls })
    expect(lastMode('p1')).toBeNull()
    saveMode('p1', 'auto')
    expect(lastMode('p1')).toBe('auto')
    expect(lastMode('p2')).toBeNull()
    store.set('astera.start.mode.p3', 'bogus')
    expect(lastMode('p3')).toBeNull()
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } })
    expect(lastMode('p1')).toBeNull()
    expect(() => saveMode('p1', 'chat')).not.toThrow()
    vi.unstubAllGlobals()
  })
})

// T4
describe('after Start made the Job', () => {
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

describe('scheduledArgs', () => {
  const rule = { kind: 'interval', minutes: 30 } as const
  const req = { cmd: 'jobs-create', args: { cwd: '/p', objective: 'x' } }
  it('adds the rule to the jobs-create args', () => {
    expect(scheduledArgs(req, rule)).toEqual({ cwd: '/p', objective: 'x', schedule: rule })
  })
  it('is null without a rule or a request', () => {
    expect(scheduledArgs(req, null)).toBeNull()
    expect(scheduledArgs(null, rule)).toBeNull()
  })
  it('is null for a request that is not jobs-create', () => {
    expect(scheduledArgs({ cmd: 'jobs-create-from-issue', args: {} }, rule)).toBeNull()
  })
})
