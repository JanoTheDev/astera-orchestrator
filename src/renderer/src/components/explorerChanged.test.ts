import { describe, expect, it } from 'vitest'
import { changedRows } from './explorerChanged'

describe('changedRows', () => {
  it('lists status files flat, sorted by folder then name, with their state', () => {
    const rows = changedRows('/r', { '/r/b.ts': 'modified', '/r/src/z.ts': 'new', '/r/src/a.ts': 'deleted' }, null)
    expect(rows.map((r) => [r.dir, r.name, r.state])).toEqual([
      ['', 'b.ts', 'modified'],
      ['src', 'a.ts', 'deleted'],
      ['src', 'z.ts', 'new']
    ])
  })
  it('adds files changed against the base, keeping the tree badge and giving them a diff id', () => {
    const rows = changedRows('/r', { '/r/a.ts': 'conflict' }, [
      { id: 'i1', path: 'a.ts', status: 'modified' },
      { id: 'i2', path: 'd/gone.ts', status: 'deleted' }
    ])
    expect(rows).toEqual([
      { path: '/r/a.ts', name: 'a.ts', dir: '', state: 'conflict', fileId: 'i1' },
      { path: '/r/d/gone.ts', name: 'gone.ts', dir: 'd', state: 'deleted', fileId: 'i2' }
    ])
  })
})
