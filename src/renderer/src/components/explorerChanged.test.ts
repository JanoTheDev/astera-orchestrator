import { describe, expect, it } from 'vitest'
import { changedRows, changeLetter } from './explorerChanged'

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
  it('marks a renamed file on its row, keeping its git state as modified', () => {
    const rows = changedRows('/r', {}, [{ id: 'i3', path: 'new/name.ts', oldPath: 'old/name.ts', status: 'renamed' }])
    expect(rows).toEqual([{ path: '/r/new/name.ts', name: 'name.ts', dir: 'new', state: 'modified', fileId: 'i3', renamed: true }])
  })
  it('does not mark a file that is not renamed', () => {
    const [row] = changedRows('/r', {}, [{ id: 'i4', path: 'a.ts', status: 'modified' }])
    expect('renamed' in row).toBe(false)
  })
})

describe('changeLetter', () => {
  it('words every state of both lists as one of A, M, D, R, C', () => {
    expect(changeLetter('new')).toBe('A')
    expect(changeLetter('added')).toBe('A')
    expect(changeLetter('modified')).toBe('M')
    expect(changeLetter('deleted')).toBe('D')
    expect(changeLetter('renamed')).toBe('R')
    expect(changeLetter('conflict')).toBe('C')
  })
})
