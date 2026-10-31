import { describe, expect, it } from 'vitest'
import { t as tr, type MessageKey } from '../../../core/i18n'
import { aboveRecommendedNote, autoLimitNote, effectiveLimitNote, newestCrashLowering } from './autoLimitNote'
import type { AgentLimits, AutoLimits } from '../../../core/types'

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
  it('formats the time with the formatter it is given', () => {
    const auto: AutoLimits = { history: [], heavy: { cap: 1, cause: 'strain', at, detail: 'lag' } }
    const seen: string[] = []
    const s = autoLimitNote(auto, 'heavy', t, (iso) => (seen.push(iso), 'FORMATTED'))!
    expect(seen).toEqual([at])
    expect(s).toContain('FORMATTED')
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

describe('effectiveLimitNote', () => {
  const base: AgentLimits = { person: 25, effective: 25, recommended: 14, memoryPerAgentGb: 1.5, minUnderPressure: { value: 13, isDefault: true } }
  const lowered = (cause: 'strain' | 'crash' | 'oom'): AgentLimits => ({
    ...base,
    effective: 9,
    autoLimit: { cap: 9, cause, at, detail: 'memory was 6% free while 10 agents ran' }
  })
  it('is null when no auto-limit lowers the limit', () => {
    expect(effectiveLimitNote(base, t)).toBeNull()
  })
  it('names the limit in force, the owner value, the time and what was seen; a strain comes back by itself', () => {
    const s = effectiveLimitNote(lowered('strain'), t, () => '31 Oct 11:24')!
    expect(s).toContain('at most 9 of your 25')
    expect(s).toContain('31 Oct 11:24')
    expect(s).toContain('memory was 6% free while 10 agents ran')
    expect(s).toContain('by itself')
  })
  it('formats the time with the formatter it is given, not the OS locale', () => {
    const seen: string[] = []
    const s = effectiveLimitNote(lowered('strain'), t, (iso) => (seen.push(iso), 'IN-APP-LANGUAGE'))!
    expect(seen).toEqual([at])
    expect(s).toContain('IN-APP-LANGUAGE')
  })
  it('says a crash or oom limit stays until restored', () => {
    for (const cause of ['crash', 'oom'] as const) expect(effectiveLimitNote(lowered(cause), t)).toContain('until you restore')
  })
  it('reads in every language with the same figures', () => {
    for (const lang of ['ko', 'ja', 'es'] as const) {
      const s = effectiveLimitNote(lowered('crash'), (k, p) => tr(lang, k, p), () => 'D')!
      expect(s).toContain('9')
      expect(s).toContain('25')
      expect(s).toContain('D')
    }
  })
})

describe('aboveRecommendedNote', () => {
  const l = { person: 25, recommended: 14, memoryPerAgentGb: 1.5 }
  it('is null at or below the recommendation', () => {
    expect(aboveRecommendedNote({ ...l, person: 14 }, t)).toBeNull()
  })
  it('states the recommendation and the measured memory per agent as plain information', () => {
    const s = aboveRecommendedNote(l, t)!
    expect(s).toContain('14')
    expect(s).toContain('1.5 GB')
    expect(s).not.toMatch(/warn|error|may run out/i)
  })
})
