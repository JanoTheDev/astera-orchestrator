import { describe, it, expect } from 'vitest'
import {
  MODEL_ID,
  clampEffort,
  nextRung,
  resolveRoleEffort,
  resolveWorkerEffort,
  dispatchModelFields,
  modelFitsProvider,
  pickTaskProvider,
  readRoleModelSettings,
  resolveCoordinatorModel,
  resolveReviewerModel,
  resolveRoleModel,
  resolveWorkerModel
} from './roleModels'
import type { Account } from '../types'

const acct = (id: string, provider: 'claude' | 'codex' = 'claude'): Account =>
  ({ id, label: id, configDir: `/cfg/${id}`, color: '#888', createdAt: '2026-10-17T00:00:00.000Z', provider })
const claudeOnly = [acct('c1')]
const both = [acct('c1'), acct('x1', 'codex')]

describe('resolveRoleModel', () => {
  it('job override > app setting > built-in default', () => {
    const settings = { claude: { roles: { planner: 'sonnet' } } }
    expect(resolveRoleModel(settings, { models: { planner: 'claude-opus-5-5' } }, 'planner', 'claude')).toBe('claude-opus-5-5')
    expect(resolveRoleModel(settings, undefined, 'planner', 'claude')).toBe('sonnet')
    expect(resolveRoleModel({}, undefined, 'planner', 'claude')).toBe('opus')
  })

  it('the owner defaults: planner and reviewer opus, coordinator haiku, worker none', () => {
    expect(resolveRoleModel({}, undefined, 'coordinator', 'claude')).toBe('haiku')
    expect(resolveRoleModel({}, undefined, 'reviewer', 'claude')).toBe('opus')
    expect(resolveRoleModel({}, undefined, 'worker', 'claude')).toBeUndefined()
  })

  it('an emptied setting means the CLI default (undefined), not the built-in one', () => {
    expect(resolveRoleModel({ claude: { roles: { planner: '' } } }, undefined, 'planner', 'claude')).toBeUndefined()
  })

  it('codex has no built-in models, and never gets a claude alias from a Job override', () => {
    expect(resolveRoleModel({}, undefined, 'planner', 'codex')).toBeUndefined()
    expect(resolveRoleModel({}, { models: { planner: 'opus' } }, 'planner', 'codex')).toBeUndefined()
    expect(resolveRoleModel({ codex: { roles: { planner: 'gpt-5.5' } } }, undefined, 'planner', 'codex')).toBe('gpt-5.5')
  })

  it('an empty Job override does not mask the app setting', () => {
    expect(resolveRoleModel({}, { models: { planner: '  ' } }, 'planner', 'claude')).toBe('opus')
  })
})

describe('resolveCoordinatorModel', () => {
  const tasks = (n: number, hard = false) => Array.from({ length: n }, (_, i) => ({ difficulty: hard && i === 0 ? ('hard' as const) : ('standard' as const) }))
  const base = { settings: {}, job: undefined, project: undefined, provider: 'claude' as const }

  it('a small plan keeps the role default; more than 5 Tasks or any hard Task gets the strong model', () => {
    expect(resolveCoordinatorModel({ ...base, tasks: tasks(5) })).toBe('haiku')
    expect(resolveCoordinatorModel({ ...base, tasks: tasks(6) })).toBe('opus')
    expect(resolveCoordinatorModel({ ...base, tasks: tasks(1, true) })).toBe('opus')
  })

  it('Job.models > project override > plan-size rule > app setting > built-in', () => {
    const settings = { claude: { roles: { coordinator: 'sonnet' } } }
    const big = tasks(10)
    expect(resolveCoordinatorModel({ ...base, settings, tasks: tasks(2) })).toBe('sonnet')
    expect(resolveCoordinatorModel({ ...base, settings, tasks: big })).toBe('opus')
    expect(resolveCoordinatorModel({ ...base, settings, tasks: big, project: { coordinatorModel: 'haiku' } })).toBe('haiku')
    expect(resolveCoordinatorModel({ ...base, settings, tasks: big, project: { coordinatorModel: 'haiku' }, job: { models: { coordinator: 'claude-sonnet-5-5' } } })).toBe('claude-sonnet-5-5')
  })

  it('codex takes its configured hard model, and a model of the other CLI is skipped', () => {
    const settings = { codex: { difficulty: { hard: 'gpt-5.5' } } }
    expect(resolveCoordinatorModel({ ...base, settings, provider: 'codex', tasks: tasks(6) })).toBe('gpt-5.5')
    expect(resolveCoordinatorModel({ ...base, provider: 'codex', tasks: tasks(6) })).toBeUndefined()
    expect(resolveCoordinatorModel({ ...base, tasks: tasks(1), project: { coordinatorModel: 'gpt-5.5' } })).toBe('haiku')
  })
})

describe('resolveWorkerModel', () => {
  const base = { settings: {}, job: undefined, provider: 'claude' as const, accounts: claudeOnly }

  it('Task.model > difficulty map > Job override > app default > CLI default', () => {
    const job = { models: { worker: 'sonnet' } }
    const settings = { claude: { roles: { worker: 'haiku' } } }
    expect(resolveWorkerModel({ ...base, settings, job, task: { model: 'claude-x', difficulty: 'hard' } }).model).toBe('claude-x')
    expect(resolveWorkerModel({ ...base, settings, job, task: { difficulty: 'hard' } }).model).toBe('opus')
    expect(resolveWorkerModel({ ...base, settings, job, task: {} }).model).toBe('sonnet')
    expect(resolveWorkerModel({ ...base, settings, task: {} }).model).toBe('haiku')
    expect(resolveWorkerModel({ ...base, task: {} })).toEqual({})
  })

  it('maps difficulty to haiku / sonnet / opus by default, and follows the app map', () => {
    expect(resolveWorkerModel({ ...base, task: { difficulty: 'light' } }).model).toBe('haiku')
    expect(resolveWorkerModel({ ...base, task: { difficulty: 'standard' } }).model).toBe('sonnet')
    expect(resolveWorkerModel({ ...base, settings: { claude: { difficulty: { light: 'sonnet' } } }, task: { difficulty: 'light' } }).model).toBe('sonnet')
  })

  it('a Task asking for codex with no codex account runs on claude, drops its codex model, and says why', () => {
    const r = resolveWorkerModel({ ...base, task: { provider: 'codex', model: 'gpt-5.5', difficulty: 'standard' } })
    expect(r.model).toBe('sonnet')
    expect(r.note).toMatch(/codex, which has no account/)
  })

  it('a Task asking for codex is fine once a codex account exists and it runs there', () => {
    const r = resolveWorkerModel({ ...base, provider: 'codex', accounts: both, task: { provider: 'codex', model: 'gpt-5.5' } })
    expect(r).toEqual({ model: 'gpt-5.5' })
  })
})

describe('pickTaskProvider', () => {
  it('honours the ask only among providers with an account', () => {
    expect(pickTaskProvider({ provider: 'codex' }, claudeOnly).provider).toBe('claude')
    expect(pickTaskProvider({ provider: 'codex' }, both)).toEqual({ provider: 'codex' })
    expect(pickTaskProvider({ accountIds: ['x1'] }, both)).toEqual({ provider: 'codex' })
    expect(pickTaskProvider({}, claudeOnly)).toEqual({ provider: 'claude' })
  })
})

describe('resolveReviewerModel', () => {
  it('cross-provider review uses the reviewer model as is', () => {
    expect(resolveReviewerModel({ settings: {}, job: undefined, provider: 'claude', impl: { provider: 'codex', model: 'opus' } })).toEqual({ model: 'opus' })
  })

  it('same-provider review keeps the reviewer model when it differs from the implementer\'s', () => {
    expect(resolveReviewerModel({ settings: {}, job: undefined, provider: 'claude', impl: { provider: 'claude', model: 'sonnet' } })).toEqual({ model: 'opus' })
  })

  it('same-provider review on the implementer\'s own model moves one tier (down from the top)', () => {
    const top = resolveReviewerModel({ settings: {}, job: undefined, provider: 'claude', impl: { provider: 'claude', model: 'opus' } })
    expect(top.model).toBe('sonnet')
    expect(top.note).toMatch(/moved to sonnet/)
    const settings = { claude: { roles: { reviewer: 'haiku' } } }
    expect(resolveReviewerModel({ settings, job: undefined, provider: 'claude', impl: { provider: 'claude', model: 'haiku' } }).model).toBe('sonnet')
  })
})

describe('readRoleModelSettings', () => {
  it('keeps strings (empty included) and drops everything else', () => {
    expect(readRoleModelSettings({ claude: { roles: { planner: ' opus ', worker: '', bogus: 'x', reviewer: 3 } }, codex: 'no' })).toEqual({
      claude: { roles: { planner: 'opus', worker: '' } }
    })
    expect(readRoleModelSettings(null)).toEqual({})
    expect(readRoleModelSettings([])).toEqual({})
  })
})

describe('MODEL_ID (argv trust boundary)', () => {
  it('passes aliases and vendor ids, refuses flags and shell syntax', () => {
    for (const ok of ['opus', 'claude-opus-5-5', 'claude-opus-5-5[1m]', 'gpt-5.5', 'org/model:tag'])
      expect(MODEL_ID.test(ok), ok).toBe(true)
    for (const bad of ['-x', '--dangerously-skip-permissions', 'opus&calc', 'a|b', '%PATH%', 'a b', '"q"', ''])
      expect(MODEL_ID.test(bad), bad).toBe(false)
  })
  it('a bad id from a Task, a Job or the settings resolves to nothing rather than reaching argv', () => {
    expect(resolveRoleModel({ claude: { roles: { planner: 'opus&calc' } } }, undefined, 'planner', 'claude')).toBeUndefined()
    expect(resolveRoleModel({}, { models: { planner: '--x' } }, 'planner', 'claude')).toBe('opus')
    expect(resolveWorkerModel({ settings: {}, job: undefined, provider: 'claude', accounts: claudeOnly, task: { model: '-x', difficulty: 'light' } }).model).toBe('haiku')
  })
})

describe('modelFitsProvider / dispatchModelFields', () => {
  it('tells the two vendors apart by name', () => {
    expect(modelFitsProvider('opus', 'codex')).toBe(false)
    expect(modelFitsProvider('gpt-5.5', 'claude')).toBe(false)
    expect(modelFitsProvider('claude-sonnet-5-5', 'claude')).toBe(true)
  })
  it('carries only what is set', () => {
    expect(dispatchModelFields({})).toEqual({})
    expect(dispatchModelFields({ model: 'opus', modelNote: 'n' })).toEqual({ model: 'opus', modelNote: 'n' })
  })
})

describe('effort resolution', () => {
  const task = (effort?: 'low' | 'max', difficulty?: 'light' | 'standard' | 'hard') => ({ effort, difficulty })
  it('Task > setting > built-in > none', () => {
    const settings = { claude: { effort: { difficulty: { hard: 'xhigh' } } } }
    expect(resolveWorkerEffort({ settings, task: task('low', 'hard'), provider: 'claude' })).toBe('low')
    expect(resolveWorkerEffort({ settings, task: task(undefined, 'hard'), provider: 'claude' })).toBe('xhigh')
    expect(resolveWorkerEffort({ settings, task: task(undefined, 'light'), provider: 'claude' })).toBe('low')
    expect(resolveWorkerEffort({ settings: {}, task: task(undefined, 'standard'), provider: 'claude' })).toBe('medium')
    expect(resolveWorkerEffort({ settings: {}, task: task(), provider: 'claude' })).toBeUndefined()
    expect(resolveWorkerEffort({ settings: {}, task: task(undefined, 'hard'), provider: 'codex' })).toBeUndefined()
  })
  it('Task > Job > setting > built-in', () => {
    const settings = { claude: { effort: { difficulty: { hard: 'xhigh' } } } }
    expect(resolveWorkerEffort({ settings, task: task('low', 'hard'), job: { effort: 'max' }, provider: 'claude' })).toBe('low')
    expect(resolveWorkerEffort({ settings, task: task(undefined, 'hard'), job: { effort: 'max' }, provider: 'claude' })).toBe('max')
    expect(resolveWorkerEffort({ settings, task: task(), job: { effort: 'medium' }, provider: 'claude' })).toBe('medium')
    expect(resolveWorkerEffort({ settings, task: task(undefined, 'hard'), job: {}, provider: 'claude' })).toBe('xhigh')
  })
  it("'' masks the built-in", () => {
    expect(resolveWorkerEffort({ settings: { claude: { effort: { difficulty: { hard: '' } } } }, task: task(undefined, 'hard'), provider: 'claude' })).toBeUndefined()
    expect(resolveRoleEffort({ claude: { effort: { roles: { planner: '' } } } }, 'planner', 'claude')).toBeUndefined()
  })
  it('roles: setting > built-in', () => {
    expect(resolveRoleEffort({}, 'planner', 'claude')).toBe('high')
    expect(resolveRoleEffort({}, 'coordinator', 'claude')).toBe('low')
    expect(resolveRoleEffort({ claude: { effort: { roles: { reviewer: 'max' } } } }, 'reviewer', 'claude')).toBe('max')
    expect(resolveRoleEffort({}, 'planner', 'codex')).toBeUndefined()
  })
  it('the reader keeps known levels and "", drops the rest, leaves models alone', () => {
    expect(
      readRoleModelSettings({
        claude: { roles: { planner: 'opus' }, effort: { roles: { planner: ' high ', reviewer: 'turbo', coordinator: '' }, difficulty: { hard: 3, light: 'low' } } },
        codex: { effort: { roles: { planner: 'bogus' } } }
      })
    ).toEqual({ claude: { roles: { planner: 'opus' }, effort: { roles: { planner: 'high', coordinator: '' }, difficulty: { light: 'low' } } } })
  })
})

describe('clampEffort', () => {
  const all = ['low', 'medium', 'high', 'xhigh', 'max']
  it('keeps a listed level', () => expect(clampEffort('high', all, 'claude')).toEqual({ effort: 'high' }))
  it('moves to the nearest listed level, a tie going down', () => {
    expect(clampEffort('xhigh', ['low', 'medium', 'high'], 'claude')).toMatchObject({ effort: 'high', note: expect.any(String) })
    expect(clampEffort('medium', ['low', 'high'], 'claude').effort).toBe('low')
    expect(clampEffort('low', ['medium', 'high'], 'claude').effort).toBe('medium')
  })
  it('above the max: the max', () => expect(clampEffort('max', ['low', 'high'], 'claude').effort).toBe('high'))
  it('no levels: no effort, no note; unknown levels: no effort plus a note', () => {
    expect(clampEffort('high', [], 'claude')).toEqual({})
    const r = clampEffort('high', undefined, 'claude')
    expect(r.effort).toBeUndefined()
    expect(r.note).toMatch(/unknown/)
  })
  it('codex is limited to CODEX_EFFORT_ROWS', () => {
    expect(clampEffort('max', all, 'codex').effort).toBe('xhigh')
    expect(clampEffort('max', ['max'], 'codex')).toEqual({})
  })
})

describe('nextRung', () => {
  const step = (model: string | undefined, effort: string | undefined, provider: 'claude' | 'codex' = 'claude') => {
    const r = nextRung({ model, effort }, provider)
    return `${r.model ?? '-'}/${r.effort ?? '-'}`
  }
  it('climbs effort first, then the model: sonnet/medium → sonnet/high → opus/high → opus/xhigh → opus/max', () => {
    expect(step('sonnet', 'medium')).toBe('sonnet/high')
    expect(step('sonnet', 'high')).toBe('opus/high')
    expect(step('opus', 'high')).toBe('opus/xhigh')
    expect(step('opus', 'xhigh')).toBe('opus/max')
  })
  it('effort below high climbs one level on the same model', () => {
    expect(step('haiku', 'low')).toBe('haiku/medium')
    expect(step('opus', 'low')).toBe('opus/medium')
  })
  it('effort high or above on a lower tier moves one tier up at high', () => {
    expect(step('haiku', 'high')).toBe('sonnet/high')
    expect(step('sonnet', 'xhigh')).toBe('opus/high')
    expect(step('claude-sonnet-5-5', 'max')).toBe('opus/high')
  })
  it('a model that took no effort moves one tier up at high', () => {
    expect(step('haiku', undefined)).toBe('sonnet/high')
  })
  it('opus/max stays, and the reason says so', () => {
    const r = nextRung({ model: 'opus', effort: 'max' }, 'claude')
    expect(r).toMatchObject({ model: 'opus', effort: 'max', reason: expect.stringMatching(/already the best model at max effort/) })
  })
  it('a model with no tier climbs effort only, up to max', () => {
    expect(step('gpt-5.5', 'medium', 'codex')).toBe('gpt-5.5/high')
    expect(step('gpt-5.5', 'max', 'codex')).toBe('gpt-5.5/max')
    expect(step(undefined, 'high')).toBe('-/xhigh')
    expect(step(undefined, undefined)).toBe('-/-')
  })
  it('the reason names both rungs', () => {
    expect(nextRung({ model: 'sonnet', effort: 'high' }, 'claude').reason).toBe('sonnet/high → opus/high')
  })
})

describe('dispatchModelFields effort', () => {
  it('copies effort and effortNote, omitting empties', () => {
    expect(dispatchModelFields({ effort: 'high', effortNote: 'n' })).toEqual({ effort: 'high', effortNote: 'n' })
    expect(dispatchModelFields({ effort: '' })).toEqual({})
  })
})
