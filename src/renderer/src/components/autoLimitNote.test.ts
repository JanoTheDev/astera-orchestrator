import { describe, expect, it } from 'vitest'
import { t as tr, type MessageKey } from '../../../core/i18n'
import { autoLimitNote, newestCrashLowering } from './autoLimitNote'
import type { AutoLimits } from '../../../core/types'

const t = (key: MessageKey, p?: Record<string, string | number>): string => tr('en', key, p)
const at = '2026-10-26T10:00:00.000Z'

describe('autoLimitNote', () => {
  it('is null without a cap', () => {
    expect(autoLimitNote({ history: [] }, 'workers', t)).toBeNull()
  })
  it('says a crash cap stays until restored', () => {
    const auto: AutoLimits = { history: [], workers: { cap: 4, cause: 'crash', at, detail: 'host died' } }
    const s = autoLimitNote(auto, 'workers', t, () => 'D')!
    expect(s).toContain('4')
    expect(s).toContain('host died')
    expect(s).toContain('until you restore')
    expect(autoLimitNote(auto, 'heavy', t)).toBeNull()
  })
  it('says a strain cap comes back by itself', () => {
    const auto: AutoLimits = { history: [], heavy: { cap: 1, cause: 'strain', at, detail: 'lag' } }
    expect(autoLimitNote(auto, 'heavy', t)).toContain('by itself')
  })
})

describe('newestCrashLowering', () => {
  it('picks the newest crash or oom lowering, skipping strain and resets', () => {
    const row = (a: string, cause: AutoLimits['history'][number]['cause'], to: number | null) => ({ at: a, what: 'workers' as const, from: 8, to, cause, detail: '' })
    expect(newestCrashLowering({ history: [row('1', 'oom', 4), row('2', 'strain', 3), row('3', 'reset', null)] })).toBe('1')
    expect(newestCrashLowering({ history: [] })).toBeNull()
  })
})
