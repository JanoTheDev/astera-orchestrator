import { describe, it, expect } from 'vitest'
import type { Account } from '../../../../core/types'
import type { Job, JobRun, Task } from '../../../../core/orchestration/types'
import { activeAccountOf, consolesOfSessions, activityClick, activityOnLaunch, nextQueuedLine, readWorkbenchLayout, runningPlans, shellCounts, shownPanelTab, statusUsageOf } from './shellView'
import type { WallConsole } from '../wall/wallModel'
import { t } from '../../../../core/i18n'

const en = (k: Parameters<typeof t>[1], p?: Parameters<typeof t>[2]): string => t('en', k, p)

describe('shellCounts', () => {
  const sessions = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'running' },
    { id: 'c', status: 'running' },
    { id: 'd', status: 'exited' }
  ]

  it('counts live consoles and the working ones; an ended console counts for neither', () => {
    const c = shellCounts(sessions, { a: 'working', b: 'waiting', d: 'working' }, [], [])
    expect([c.consoles, c.working]).toEqual([3, 1])
  })

  it('the waiting count is the Inbox’s needs-you list, so the status bar and the Inbox tab never disagree', () => {
    expect(shellCounts(sessions, { b: 'waiting' }, [{ kind: 'session' }, { kind: 'gate' }], []).waiting).toBe(2)
    expect(shellCounts([], {}, [], []).waiting).toBe(0)
  })

  it('the Agents badge is the Needs you pane’s row count: waiting consoles, not the Inbox items', () => {
    const console = (sessionId: string, state: WallConsole['state']): WallConsole =>
      ({ sessionId, label: sessionId, role: 'console', state, projectId: null, planOrder: 0, cwd: '/r', chat: true }) as WallConsole
    const consoles = [console('a', 'needs'), console('b', 'working'), console('d', 'finished')]
    const c = shellCounts(sessions, { a: 'waiting' }, [{ kind: 'session' }, { kind: 'gate' }, { kind: 'session' }], consoles)
    expect([c.agents, c.waiting]).toEqual([1, 3])
  })

  it('consolesOfSessions keeps only the consoles whose session is in the list', () => {
    const consoles = [{ sessionId: 'a' }, { sessionId: 'x' }] as WallConsole[]
    expect(consolesOfSessions(consoles, [{ id: 'a' }]).map((c) => c.sessionId)).toEqual(['a'])
  })

  it('the Agents badge counts only consoles of the scope it is given', () => {
    const consoles = [{ sessionId: 'a', state: 'needs' }, { sessionId: 'x', state: 'needs' }] as WallConsole[]
    expect(shellCounts(sessions, {}, [], consoles).agents).toBe(1)
  })
})

describe('nextQueuedLine', () => {
  const job = (id: string, over: Partial<Job> = {}): Job => ({ id, objective: `objective ${id}`, cwd: '/r', createdAt: '2026-10-01T00:00:00Z', ...over })
  const run = (id: string, jobId: string, over: Partial<JobRun> = {}): JobRun => ({ id, jobId, ordinal: 1, createdAt: '2026-10-01T00:00:00Z', ...over })
  const none = { runs: [] as JobRun[], tasks: [] as Task[] }

  it('is null with nothing queued', () => {
    expect(nextQueuedLine({ jobs: [job('a', { title: 'Auth' })], ...none }, en)).toBeNull()
  })

  it('names the oldest queued plan and what it waits for, and counts the rest', () => {
    const jobs = [
      job('api', { title: 'Leaderboard API' }),
      job('r2', { title: 'Redesign 9.2', after: 'api', pendingStart: true, createdAt: '2026-10-03T00:00:00Z' }),
      job('r1', { title: 'Redesign 9.1', after: 'api', pendingStart: true, createdAt: '2026-10-02T00:00:00Z' })
    ]
    expect(nextQueuedLine({ jobs, ...none }, en)).toBe('Next: Redesign 9.1 starts after Leaderboard API delivers (+1)')
  })

  it('a plan already planning is not queued any more', () => {
    const jobs = [job('api'), job('r', { after: 'api', pendingStart: true, plannerSessionIds: ['p'] })]
    expect(nextQueuedLine({ jobs, ...none }, en)).toBeNull()
  })

  it('says so when the plan it waits on stopped', () => {
    const jobs = [job('api', { title: 'API', archivedAt: '2026-10-02T00:00:00Z' }), job('r', { title: 'R', after: 'api', pendingStart: true })]
    expect(nextQueuedLine({ jobs, runs: [run('x', 'api')], tasks: [] }, en)).toBe('Next: R waits on API, which stopped')
  })
})

describe('activeAccountOf', () => {
  const acc = (id: string): Account => ({ id, label: id, configDir: `/c/${id}`, color: 'x', createdAt: '' })
  it('is the focused console’s account, else the first', () => {
    expect(activeAccountOf([acc('a'), acc('b')], 'b')?.id).toBe('b')
    expect(activeAccountOf([acc('a'), acc('b')], undefined)?.id).toBe('a')
    expect(activeAccountOf([acc('a')], 'gone')?.id).toBe('a')
    expect(activeAccountOf([], 'a')).toBeUndefined()
  })
})

describe('workbench layout (DESIGN-W13)', () => {
  const store = (o: Record<string, string>) => (k: string): string | null => o[k] ?? null

  it('defaults with nothing saved: Agents, side bar shown at 260px, panel hidden on Needs you', () => {
    expect(readWorkbenchLayout(store({}))).toEqual({ activity: 'agents', sidebarVisible: true, sidebarWidth: 260, panelVisible: false, panelTab: 'needs' })
  })

  it('restores the side bar width (clamped), visibility, panel and panel tab', () => {
    const l = readWorkbenchLayout(store({ 'cm.sidebar.width': '420', 'cm.sidebar.visible': 'false', 'cm.panel.visible': 'true', 'cm.panel.tab': 'terminal' }))
    expect(l).toMatchObject({ sidebarWidth: 420, sidebarVisible: false, panelVisible: true, panelTab: 'terminal' })
    expect(readWorkbenchLayout(store({ 'cm.sidebar.width': '9000' })).sidebarWidth).toBe(600)
    expect(readWorkbenchLayout(store({ 'cm.sidebar.width': 'wide' })).sidebarWidth).toBe(260)
    expect(readWorkbenchLayout(store({ 'cm.panel.tab': 'bogus' })).panelTab).toBe('needs')
  })

  it('restores the activity from cm.activity, else maps the old cm.page', () => {
    expect(activityOnLaunch(store({ 'cm.activity': 'explorer' }))).toBe('explorer')
    expect(activityOnLaunch(store({ 'cm.activity': 'scm', 'cm.page': 'plans' }))).toBe('scm')
    expect(activityOnLaunch(store({ 'cm.page': 'files' }))).toBe('explorer')
    expect(activityOnLaunch(store({ 'cm.page': 'worktrees' }))).toBe('scm')
    expect(activityOnLaunch(store({ 'cm.page': 'settings' }))).toBe('agents')
    expect(activityOnLaunch(store({ 'cm.activity': 'nope' }))).toBe('agents')
  })

  it('a click on the active activity collapses the side bar; any other click shows that view', () => {
    expect(activityClick({ activity: 'plans', sidebarVisible: true }, 'plans')).toEqual({ activity: 'plans', sidebarVisible: false })
    expect(activityClick({ activity: 'plans', sidebarVisible: false }, 'plans')).toEqual({ activity: 'plans', sidebarVisible: true })
    expect(activityClick({ activity: 'plans', sidebarVisible: true }, 'scm')).toEqual({ activity: 'scm', sidebarVisible: true })
  })

  it('Output and Terminal follow the console strip: the run tab is Output, a shell is Terminal', () => {
    expect(shownPanelTab('needs', 'run')).toBe('needs')
    expect(shownPanelTab('activity', 't1')).toBe('activity')
    expect(shownPanelTab('terminal', 'run')).toBe('output')
    expect(shownPanelTab('output', 't1')).toBe('terminal')
  })
})

describe('Agents view groups and the Plans badge', () => {
  it('counts running plans only', () => {
    expect(runningPlans([{ outcome: 'running' }, { outcome: 'running', paused: true }, { outcome: 'running', archivedAt: 'x' }, { outcome: 'failed' }] as never)).toBe(1)
  })
})

describe('statusUsageOf', () => {
  const win = (usedPercent: number) => ({ usedPercent, resetsAt: null })
  const reading = { session: win(12), weekly: win(40), readAt: '2026-10-31T12:00:00.000Z', remembered: false }
  const ultra = { id: 'ultra', raw: 'ultra', hasSessionWindow: false } as const
  const max = { id: 'max', raw: 'max', hasSessionWindow: true } as const

  it('an Ultra account shows no 5-hour figure, even when its reading carries a session window', () => {
    expect(statusUsageOf(ultra, reading)).toEqual({ five: undefined, week: 40 })
  })

  it('keeps both figures while the plan is unknown, or when the plan has a 5-hour window', () => {
    expect(statusUsageOf(undefined, reading)).toEqual({ five: 12, week: 40 })
    expect(statusUsageOf(max, reading)).toEqual({ five: 12, week: 40 })
  })

  it('a reading with no session window shows no 5-hour figure', () => {
    expect(statusUsageOf(undefined, { ...reading, session: null })).toEqual({ five: undefined, week: 40 })
  })
})
