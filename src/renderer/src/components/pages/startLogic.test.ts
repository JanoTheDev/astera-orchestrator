import { describe, it, expect, vi } from 'vitest'
import {
  accountPickOptions, askOptions, attachableOf, afterCreate, blockedReason, consolesIn, dropOpensStart, filesFromDrop, intakeTab, isSubmitKey, lastMode, lookupArgs, planningOf, primaryLabel,
  projectChoice, projectDefaults, promptCount, rememberSetting, saveMode, scheduledArgs, settingsKey, settingsSummary, startSettings, STARTERS, STARTER_MODE, livePlans, shouldLandOnStart,
  withStarter, type PlanRow
} from './startLogic'
import type { Account } from '../../../../core/types'
import type { Project } from '../../../../core/orchestration/types'

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

// T17
describe('who the plan is for', () => {
  const proj = (id: string, o: Partial<Project> = {}): Project => ({ id, name: id.toUpperCase(), path: `/w/${id}`, addedAt: '', ...o })
  const app = proj('app')
  const ws = proj('ws')
  const api = proj('ws-api', { path: '/w/ws', parentId: 'ws' })
  const web = proj('ws-web', { path: '/w/ws', parentId: 'ws' })
  const all = [app, ws, api, web]
  it('is the title bar project, with no picker, when it has no sub-projects', () => {
    expect(projectChoice(all, 'app')).toEqual({ ask: false, root: app, members: [], project: app })
  })
  it('offers the workspace and its sub-projects by id; a pick files the plan there', () => {
    const c = projectChoice(all, 'ws', 'ws-web')
    expect(c.members.map((p) => p.id)).toEqual(['ws', 'ws-api', 'ws-web'])
    expect(c.project).toBe(web)
    expect(c.root).toBe(ws)
    // sub-projects share the folder: the pick is by id, never by path
    expect(projectChoice(all, 'ws', 'ws-api').project).toBe(api)
    expect(projectChoice(all, 'ws').project).toBe(ws)
  })
  it('a sub-project picked in the title bar is the default, under its workspace', () => {
    const c = projectChoice(all, 'ws-api')
    expect(c.root).toBe(ws)
    expect(c.project).toBe(api)
    expect(c.members).toHaveLength(3)
  })
  it('a pick that is not a member of the workspace falls back to the title bar project', () => {
    expect(projectChoice(all, 'app', 'ws-api').project).toBe(app)
  })
  it('asks only on All projects (or for a selection no project has), listing workspaces and plain projects', () => {
    expect(projectChoice(all, null)).toEqual({ ask: true, members: [] })
    expect(projectChoice(all, 'gone').ask).toBe(true)
    // still loading: a selected project is not asked for again
    expect(projectChoice([], 'app').ask).toBe(false)
    expect(askOptions(all)).toEqual([{ value: 'app', label: 'APP' }, { value: 'ws', label: 'WS' }])
  })
})

describe('the settings', () => {
  const proj = (o: Partial<Project> = {}): Project => ({ id: 'p1', name: 'P', path: '/p', addedAt: '', ...o })
  it("start from the project's defaults, a sub-project's unset ones from its workspace", () => {
    expect(projectDefaults(undefined, undefined)).toEqual({ account: '', effort: '', concurrency: 3, delivery: 'pr', replan: 'waves', handsOff: false })
    expect(projectDefaults(proj({ delivery: 'merge', concurrency: 10, replan: 'off', handsOff: true }), undefined)).toMatchObject({ delivery: 'merge', concurrency: 10, replan: 'off', handsOff: true })
    const root = proj({ id: 'ws', delivery: 'push', concurrency: 5 })
    expect(projectDefaults(proj({ id: 'sub', parentId: 'ws', concurrency: 2 }), root)).toMatchObject({ delivery: 'push', concurrency: 2 })
  })
  it('remember the last choice per project; untouched fields keep following the project', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } })
    const base = projectDefaults(proj({ delivery: 'merge' }), undefined)
    expect(startSettings('p1', base)).toEqual(base)
    rememberSetting('p1', { effort: 'high' })
    rememberSetting('p1', { account: 'acc2', concurrency: 7, replan: 'off', handsOff: true })
    expect(startSettings('p1', base)).toEqual({ ...base, effort: 'high', account: 'acc2', concurrency: 7, replan: 'off', handsOff: true })
    expect(startSettings('p2', base)).toEqual(base)
    rememberSetting('p1', { delivery: 'manual' })
    expect(startSettings('p1', base).delivery).toBe('manual')
    vi.unstubAllGlobals()
  })
  it('drop stored nonsense, and work when storage fails', () => {
    const store = new Map([[settingsKey('p1'), JSON.stringify({ effort: 'huge', delivery: 'fax', concurrency: 0, replan: 1, handsOff: 'yes', account: 4 })]])
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: () => {} } })
    const base = projectDefaults(undefined, undefined)
    expect(startSettings('p1', base)).toEqual(base)
    store.set(settingsKey('p1'), '{not json')
    expect(startSettings('p1', base)).toEqual(base)
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } })
    expect(startSettings('p1', base)).toEqual(base)
    expect(() => rememberSetting('p1', { effort: 'low' })).not.toThrow()
    vi.unstubAllGlobals()
  })
  it('read as one summary row', () => {
    const s = { when: 'now' as const, concurrency: 10, delivery: 'Merge into main', replan: 'waves' as const, handsOff: true, effort: '' as const }
    expect(settingsSummary(s, t)).toEqual(['start.sum.auto', 'start.opt.now', 'start.sum.agents:{"n":10}', 'Merge into main', 'start.opt.handsOff', 'start.sum.effort:{"level":"start.effort.auto"}'])
    const other = settingsSummary({ ...s, account: 'Work', when: 'after', after: 'Login fix', handsOff: false, replan: 'off', effort: 'high' }, t)
    expect(other).toEqual(['Work', 'start.opt.after:{"plan":"Login fix"}', 'start.sum.agents:{"n":10}', 'Merge into main', 'start.adv.replan.off', 'start.sum.effort:{"level":"high"}'])
    expect(settingsSummary({ ...s, when: 'schedule' }, t)[1]).toBe('start.when.schedule')
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
    expect(afterCreate(undefined)).toEqual({ openActivity: 'agents' })
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

describe('attachableOf (T4 paste to attach)', () => {
  it('saves a pathless clipboard image through the IPC and attaches the answered path', async () => {
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' })
    const save = vi.fn(async () => '/u/intake-paste/id/image-1.png')
    const r = await attachableOf([image], () => '', save)
    expect(save).toHaveBeenCalledWith('image.png', 'image/png', btoa(String.fromCharCode(137, 80, 78, 71)))
    expect(r).toEqual({ attached: [{ file: image, path: '/u/intake-paste/id/image-1.png' }], failed: [] })
  })

  it('attaches a copied OS file by its own path without saving it', async () => {
    const doc = new File(['x'], 'spec.md')
    const save = vi.fn()
    const r = await attachableOf([doc], () => '/w/spec.md', save)
    expect(save).not.toHaveBeenCalled()
    expect(r.attached.map((a) => a.path)).toEqual(['/w/spec.md'])
  })

  it('names a file the save refused and still attaches the rest', async () => {
    const big = new File(['x'], 'big.png', { type: 'image/png' })
    const ok = new File(['y'], 'ok.md')
    const r = await attachableOf([big, ok], (f) => (f === ok ? '/w/ok.md' : ''), async () => Promise.reject(new Error('ATTACHMENT_TOO_LARGE')))
    expect(r).toEqual({ attached: [{ file: ok, path: '/w/ok.md' }], failed: ['big.png'] })
  })

  it('attaches nothing for a paste with no files (text pastes through)', async () => {
    expect(await attachableOf([], () => '', vi.fn())).toEqual({ attached: [], failed: [] })
  })
})
