// Saving an effort writes its own key and leaves the model settings alone.
import { describe, expect, it } from 'vitest'
import { withEffort } from './OrchestratorModelsSettings'

const base = { claude: { roles: { planner: 'opus' }, difficulty: { light: 'haiku' } } }

describe('withEffort', () => {
  it('writes the difficulty key and keeps the models', () => {
    const next = withEffort(base, 'claude', 'difficulty', 'hard', 'max')
    expect(next.claude).toEqual({ ...base.claude, effort: { difficulty: { hard: 'max' } } })
  })

  it('CLI default saves an empty string, not a removal', () => {
    expect(withEffort(base, 'claude', 'roles', 'planner', '').claude?.effort?.roles).toEqual({ planner: '' })
  })

  it('the built-in choice removes only that key', () => {
    const had = withEffort(withEffort(base, 'claude', 'roles', 'planner', 'low'), 'claude', 'roles', 'reviewer', 'max')
    expect(withEffort(had, 'claude', 'roles', 'planner', 'builtin').claude?.effort?.roles).toEqual({ reviewer: 'max' })
  })
})
