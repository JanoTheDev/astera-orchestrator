import { describe, expect, it } from 'vitest'
import type { LocalHistoryEntry } from '../../../core/types'
import { explorerPathItems, historyForFile } from './explorerMenu'

describe('explorerPathItems', () => {
  it('gives a clean file Open only', () => {
    expect(explorerPathItems({ isDir: false }, undefined)).toEqual(['open'])
    expect(explorerPathItems({ isDir: false }, 'new')).toEqual(['open'])
  })
  it('adds Open Diff for a modified file only', () => {
    expect(explorerPathItems({ isDir: false }, 'modified')).toEqual(['open', 'openDiff'])
  })
  it('gives a folder Open in Terminal, never Open or Open Diff', () => {
    expect(explorerPathItems({ isDir: true }, undefined)).toEqual(['openTerminal'])
  })
})

describe('historyForFile', () => {
  const e = (id: string, originalPath: string): LocalHistoryEntry =>
    ({ id, originalPath, deletedAt: 0, size: 0, isDir: false }) as LocalHistoryEntry
  const list = [e('1', '/r/a.ts'), e('2', '/r/b.ts'), e('3', '/r/a.ts')]
  it('keeps only the clicked file', () => {
    expect(historyForFile(list, '/r/a.ts').map((x) => x.id)).toEqual(['1', '3'])
  })
  it('keeps everything without a file', () => {
    expect(historyForFile(list, undefined)).toBe(list)
  })
})
