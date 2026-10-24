import { describe, it, expect, vi } from 'vitest'
import type { ModelDescriptor, ModelListResult } from './types'
import { createEffortLevelsLookup, effortLevelsOf } from './effortLevels'

// The shapes parse.test.ts pins: claude ids are the aliases `--model` takes, codex ids are full names.
const claude: ModelDescriptor[] = [
  { provider: 'claude', id: 'default', name: 'Default (recommended)', isDefault: true, resolvedModel: 'claude-opus-5[1m]', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'claude', id: 'sonnet', name: 'Sonnet', resolvedModel: 'claude-sonnet-5', effortLevels: ['low', 'high'] },
  { provider: 'claude', id: 'haiku', name: 'Haiku', resolvedModel: 'claude-haiku-4-5-20251001' }
]
const codex: ModelDescriptor[] = [
  { provider: 'codex', id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', isDefault: true, effortLevels: ['low', 'medium', 'high', 'xhigh'] }
]

describe('effortLevelsOf', () => {
  it('matches by id or name, case-insensitive', () => {
    expect(effortLevelsOf(claude, 'sonnet')).toEqual(['low', 'high'])
    expect(effortLevelsOf(claude, 'SONNET')).toEqual(['low', 'high'])
    expect(effortLevelsOf(codex, 'gpt-5.6-sol')).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(effortLevelsOf(codex, 'GPT-5.6-Sol')).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('matches the full model name an alias resolves to, and an alias of a fuller id', () => {
    expect(effortLevelsOf(claude, 'claude-sonnet-5')).toEqual(['low', 'high'])
    expect(effortLevelsOf(codex, 'gpt-5.6')).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('no model is the default entry', () => {
    expect(effortLevelsOf(claude, undefined)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(effortLevelsOf(claude.slice(1), undefined)).toBeUndefined()
  })

  it('an unknown model is "could not tell", not the default', () => {
    expect(effortLevelsOf(claude, 'opus')).toBeUndefined()
    expect(effortLevelsOf(claude, 'son')).toBeUndefined()
  })

  it('a model without levels takes no effort', () => {
    expect(effortLevelsOf(claude, 'haiku')).toEqual([])
  })
})

describe('createEffortLevelsLookup', () => {
  it('asks once per account, for calls in a row and at once', async () => {
    const list = vi.fn(async (): Promise<ModelListResult> => ({ models: claude }))
    const effortLevelsFor = createEffortLevelsLookup(list)
    const both = await Promise.all([effortLevelsFor('a', 'sonnet'), effortLevelsFor('a', undefined)])
    expect(both).toEqual([['low', 'high'], ['low', 'medium', 'high', 'xhigh', 'max']])
    expect(await effortLevelsFor('a', 'haiku')).toEqual([])
    expect(list).toHaveBeenCalledTimes(1)
    await effortLevelsFor('b', 'sonnet')
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failure: the next start asks again', async () => {
    const list = vi
      .fn<(id: string) => Promise<ModelListResult>>()
      .mockResolvedValueOnce({ models: [], error: 'logged out' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ models: claude })
    const effortLevelsFor = createEffortLevelsLookup(list)
    expect(await effortLevelsFor('a', 'sonnet')).toBeUndefined()
    expect(await effortLevelsFor('a', 'sonnet')).toBeUndefined()
    expect(await effortLevelsFor('a', 'sonnet')).toEqual(['low', 'high'])
    expect(await effortLevelsFor('a', 'sonnet')).toEqual(['low', 'high'])
    expect(list).toHaveBeenCalledTimes(3)
  })
})
