import { describe, expect, it } from 'vitest'
import type { LicenseEntry } from '../../../../core/types'
import { filterLicenses } from './LicensesView'

const e = (name: string, license: string): LicenseEntry => ({ kind: 'package', name, version: '1.0.0', license, text: '' })
const entries = [e('react', 'MIT'), e('undici', 'MIT'), e('@xterm/xterm', 'MIT'), e('node-pty', 'Apache-2.0')]

describe('filterLicenses', () => {
  it('an empty query is every entry', () => {
    expect(filterLicenses(entries, '  ')).toEqual(entries)
  })
  it('matches the name or the license, case-insensitively', () => {
    expect(filterLicenses(entries, 'XTERM').map((x) => x.name)).toEqual(['@xterm/xterm'])
    expect(filterLicenses(entries, 'apache').map((x) => x.name)).toEqual(['node-pty'])
  })
  it('finds nothing for an unknown name', () => {
    expect(filterLicenses(entries, 'zzz')).toEqual([])
  })
})
