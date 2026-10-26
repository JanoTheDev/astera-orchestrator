import { describe, it, expect } from 'vitest'
import { customId, parseCustomId, CUSTOM_ID_MAX } from './ids'

describe('custom_id scheme', () => {
  it('round-trips every action', () => {
    expect(parseCustomId(customId({ action: 'approve', id: 'job_1' }))).toEqual({ action: 'approve', id: 'job_1' })
    expect(parseCustomId(customId({ action: 'gate', id: 'gat_1', n: 3 }))).toEqual({ action: 'gate', id: 'gat_1', n: 3 })
    expect(parseCustomId(customId({ action: 'gate-other', id: 'gat_1' }))).toEqual({ action: 'gate-other', id: 'gat_1' })
    expect(parseCustomId(customId({ action: 'feedback', id: 'job_1' }))).toEqual({ action: 'feedback', id: 'job_1' })
  })

  it('writes astera:<action>:<id>[:<n>]', () => {
    expect(customId({ action: 'gate', id: 'gat_1', n: 0 })).toBe('astera:gate:gat_1:0')
    expect(customId({ action: 'approve', id: 'job_1' })).toBe('astera:approve:job_1')
  })

  it('ignores anything else', () => {
    for (const bad of [
      '',
      'astera',
      'astera:approve',
      'astera:approve:',
      'other:approve:job_1',
      'astera:delete:job_1',
      'astera:approve:job_1:2', // n only on gate
      'astera:gate:gat_1', // gate needs n
      'astera:gate:gat_1:x',
      'astera:gate:gat_1:-1',
      'astera:gate:gat_1:01',
      'astera:gate:gat_1:1:2',
      'astera:feedback:job 1',
      `astera:approve:${'a'.repeat(CUSTOM_ID_MAX)}`,
      undefined,
      42
    ]) {
      expect(parseCustomId(bad), String(bad)).toBeNull()
    }
  })

  it('refuses to build an id over the limit or with a separator in it', () => {
    expect(() => customId({ action: 'approve', id: 'a'.repeat(CUSTOM_ID_MAX) })).toThrow()
    expect(() => customId({ action: 'approve', id: 'a:b' })).toThrow()
  })
})
