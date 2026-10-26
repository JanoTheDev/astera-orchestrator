// The palette's commands: every activity and every command DESIGN-W13 §9 names is there, each with a handler, and
// the ones with a key point at a real action of the registry.
import { describe, expect, it } from 'vitest'
import { makeActions } from '../../../../core/keys/binding'
import { ACTIVITY_IDS, PANEL_TABS } from '../../../../core/ui/pages'
import { COMMAND_CATEGORIES, PALETTE_COMMANDS, directoryOf, type PaletteCx } from './directory'

const byId = new Map(PALETTE_COMMANDS.map((c) => [c.id, c]))
const actionIds = new Set(makeActions('linux').map((a) => a.id))

describe('PALETTE_COMMANDS', () => {
  it('has a command for every activity, each bound to its Ctrl+N action', () => {
    for (const id of ACTIVITY_IDS) expect(byId.get(`view.activity.${id}`), id).toMatchObject({ category: 'view', action: `activity.${id}` })
  })
  it('has Toggle Side Bar and Toggle Panel with their keys, and a Show for each panel tab', () => {
    expect(byId.get('view.sidebar')?.action).toBe('sidebar.toggle')
    expect(byId.get('view.panel')?.action).toBe('panel.toggle')
    for (const tab of PANEL_TABS) expect(byId.has(`view.panel.${tab}`), tab).toBe(true)
  })
  it('has the plan, console, preferences and help commands', () => {
    const want: Record<string, string> = {
      'plan.new': 'plan',
      'plan.main': 'plan',
      'plan.settings': 'plan',
      'plan.pause': 'plan',
      'plan.resume': 'plan',
      'console.open': 'console',
      'preferences.settings': 'preferences',
      'preferences.keys': 'preferences',
      'preferences.theme': 'preferences',
      'help.show': 'help'
    }
    for (const [id, category] of Object.entries(want)) expect(byId.get(id)?.category, id).toBe(category)
  })
  it('gives every command a handler, a known category and a unique id; a key names a real action', () => {
    expect(new Set(PALETTE_COMMANDS.map((c) => c.id)).size).toBe(PALETTE_COMMANDS.length)
    for (const c of PALETTE_COMMANDS) {
      expect(typeof c.run, c.id).toBe('function')
      expect(COMMAND_CATEGORIES, c.id).toContain(c.category)
      if (c.action) expect(actionIds.has(c.action), c.id).toBe(true)
    }
  })
})

describe('commands that open a second list', () => {
  const plans: PaletteCx['plans'] = [
    { jobId: 'j1', name: 'Auth rework', projectId: 'p', projectName: 'gameful', projectPath: '/g', scheduled: false, pendingStart: false, sessions: [{ sessionId: 's1', role: 'worker', label: 'Auth Worker 1' }] },
    { jobId: 'j2', name: 'Billing', projectId: 'p', projectName: 'gameful', projectPath: '/g', scheduled: false, pendingStart: false, sessions: [] }
  ]
  const seen: Array<[string, unknown]> = []
  const cx = (currentPlanId: string | null): PaletteCx => ({
    t: (key) => key,
    currentPlanId,
    plans,
    intent: (intent, pins) => void seen.push([intent.kind, pins]),
    theme: { current: 'night', ids: ['night', 'dusk', 'day'], name: (id) => id, preview: (id) => void seen.push(['preview', id]), commit: (id) => void seen.push(['commit', id]) }
  })

  it('Pause acts on the open plan at once, else asks which plan', () => {
    seen.length = 0
    expect(byId.get('plan.pause')!.run(cx('j2'))).toBeUndefined()
    expect(seen).toEqual([['pause', { planId: 'j2' }]])
    const stage = byId.get('plan.pause')!.run(cx(null))
    expect(stage && stage.rows.map((r) => r.label)).toEqual(['Auth rework', 'Billing'])
    stage && stage.rows[1].pick()
    expect(seen.at(-1)).toEqual(['pause', { planId: 'j2' }])
  })
  it('Open a Console lists every plan console', () => {
    const stage = byId.get('console.open')!.run(cx('j1'))
    expect(stage && stage.rows.map((r) => [r.key, r.label])).toEqual([['s1', 'Auth Worker 1']])
  })
  it('Color Theme previews a row and puts the theme back when cancelled', () => {
    seen.length = 0
    const stage = byId.get('preferences.theme')!.run(cx(null))!
    stage.rows[1].preview!()
    stage.cancel!()
    stage.rows[2].pick()
    expect(seen).toEqual([['preview', 'dusk'], ['preview', 'night'], ['commit', 'day']])
    expect(stage.rows.find((r) => r.current)?.key).toBe('night')
  })
})

describe('directoryOf: a plan is held only by the owner\'s own hold', () => {
  const tree = [{ id: 'g', name: 'Gameful', path: '/p/g', plans: [{ jobId: 'j', name: 'Trading', projectId: 'g', archived: false, paused: false, runId: 'r', planner: [], coordinator: [], workers: [] }] }] as never
  const heldAs = (job: Record<string, unknown>): boolean | undefined =>
    directoryOf(tree, { jobsByProject: { g: [{ id: 'j', ...job }] } } as never, null, null).plans[0].held
  it('marks a plan held for the owner hold and for a hold from an older Host that sends no holdBy', () => {
    expect(heldAs({ dispatchHold: true, holdBy: 'owner' })).toBe(true)
    expect(heldAs({ dispatchHold: true })).toBe(true)
  })
  it('does not mark a replan, the final check or a replan\'s question as held, so resume falls through', () => {
    for (const holdBy of ['replanning', 'final-check', 'replan-question'] as const) expect(heldAs({ dispatchHold: true, holdBy }), holdBy).toBeUndefined()
  })
  it('does not mark a plan with no hold', () => {
    expect(heldAs({})).toBeUndefined()
  })
})
