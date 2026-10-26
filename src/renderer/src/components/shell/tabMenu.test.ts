import { describe, expect, it, vi } from 'vitest'
import { closeInSequence, closeTargets, relativeUnder, tabActions } from './tabMenu'

describe('tabActions', () => {
  it('a running local session can stop, move and duplicate, not restart', () => {
    const a = tabActions({ kind: 'local' })
    expect(a.manage).toEqual(['rename', 'stop', 'duplicate', 'moveAccount'])
    expect(a.path).toEqual(['copyId', 'copyPath', 'reveal'])
  })
  it('an exited local session can restart, not stop or move', () => {
    const a = tabActions({ kind: 'local', exited: true })
    expect(a.manage).toEqual(['rename', 'restart', 'duplicate'])
  })
  it('a remote session only copies its id', () => {
    expect(tabActions({ kind: 'remote' })).toEqual({ manage: [], path: ['copyId'] })
  })
  it('a browser tab has nothing of its own', () => {
    expect(tabActions({ kind: 'browser' })).toEqual({ manage: [], path: [] })
  })
  it('a file tab copies and reveals its path, relative only under the root', () => {
    expect(tabActions({ kind: 'file' }).path).toEqual(['copyPath', 'reveal'])
    expect(tabActions({ kind: 'file', relative: true }).path).toEqual(['copyPath', 'copyRelativePath', 'reveal'])
  })
})

describe('relativeUnder', () => {
  it('cuts the root off', () => {
    expect(relativeUnder('/a/b', '/a/b/c/d.ts')).toBe('c/d.ts')
    expect(relativeUnder('/a/b/', '/a/b/c.ts')).toBe('c.ts')
    expect(relativeUnder('C:\\a', 'C:\\a\\b.ts')).toBe('b.ts')
  })
  it('is null outside the root', () => {
    expect(relativeUnder('/a/b', '/a/bc/d.ts')).toBeNull()
    expect(relativeUnder('/a/b', '/x/y')).toBeNull()
    expect(relativeUnder(null, '/x/y')).toBeNull()
  })
})

describe('closeTargets', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('splits the group around the tab', () => {
    expect(closeTargets(ids, 'b')).toEqual({ others: ['a', 'c', 'd'], right: ['c', 'd'], all: ids })
  })
  it('the last tab has nothing to its right', () => {
    expect(closeTargets(ids, 'd').right).toEqual([])
  })
})

describe('closeInSequence', () => {
  it('waits for an open question before the next close', async () => {
    let asking = false
    const log: string[] = []
    const close = (id: string): void => {
      log.push(`close ${id}`)
      if (id === 'a') {
        asking = true
        setTimeout(() => {
          log.push('answered')
          asking = false
        }, 120)
      }
    }
    await closeInSequence(['a', 'b'], close, () => asking)
    expect(log).toEqual(['close a', 'answered', 'close b'])
  })
  it('closes every tab when nothing asks', async () => {
    const close = vi.fn()
    await closeInSequence(['a', 'b', 'c'], close, () => false)
    expect(close.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
  })
})
