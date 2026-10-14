// D2 (2026-10-14): a folder link opens the folder. In the current project it is shown in the app's explorer, every
// other folder in the system file manager. The explorer's rows are keyed by main's path.join of each name under the
// root as the explorer was given it, so the keys are found by listing, not built from the link's spelling.
import { describe, it, expect } from 'vitest'
import { folderLinkAction, revealFor, treeKeysTo } from './folderLink'

describe('folderLinkAction', () => {
  it('reveals a folder inside the project in the explorer, by its names under the root', () => {
    expect(folderLinkAction('D:\\parsingk\\astera\\src\\core', 'D:\\parsingk\\astera')).toEqual({ kind: 'explorer', segments: ['src', 'core'] })
    expect(folderLinkAction('/home/me/proj/docs', '/home/me/proj')).toEqual({ kind: 'explorer', segments: ['docs'] })
  })

  it('takes the project root itself, a trailing separator, mixed separators and Windows casing', () => {
    expect(folderLinkAction('D:\\parsingk\\astera', 'D:/parsingk/astera')).toEqual({ kind: 'explorer', segments: [] })
    expect(folderLinkAction('d:\\Parsingk\\ASTERA\\src\\', 'D:/parsingk/astera/')).toEqual({ kind: 'explorer', segments: ['src'] })
  })

  it('opens any other folder in the system file manager', () => {
    expect(folderLinkAction('C:\\Users\\a\\terraluen-review', 'D:\\parsingk\\Terraluen')).toEqual({ kind: 'system' })
    // a sibling whose name starts like the root is not inside it
    expect(folderLinkAction('D:\\parsingk\\astera-worktrees\\x', 'D:\\parsingk\\astera')).toEqual({ kind: 'system' })
    expect(folderLinkAction('D:\\parsingk\\astera\\src', null)).toEqual({ kind: 'system' })
    // case matters on POSIX
    expect(folderLinkAction('/home/me/Proj/docs', '/home/me/proj')).toEqual({ kind: 'system' })
  })
})

// Final review I2 of the links slice: a reveal names the root it was made for, and applies to that root only, once. The
// explorer mounts only while it is shown, so a request left in place was run again at every remount, and on another
// project's tree whose names happened to match.
describe('revealFor', () => {
  const request = { root: 'D:\\projA', segments: ['src', 'core'], seq: 3 }
  it('gives the names to reveal under the root the request was made for', () => {
    expect(revealFor(request, 'D:\\projA')).toEqual(['src', 'core'])
  })
  it('gives nothing for another root, no root, or no request', () => {
    expect(revealFor(request, 'D:\\projB')).toBeNull()
    expect(revealFor(request, null)).toBeNull()
    expect(revealFor(null, 'D:\\projA')).toBeNull()
  })
})

describe('treeKeysTo', () => {
  const tree: Record<string, Array<{ name: string; path: string; isDir: boolean }>> = {
    'D:/p': [{ name: 'src', path: 'D:\\p\\src', isDir: true }, { name: 'README.md', path: 'D:\\p\\README.md', isDir: false }],
    'D:\\p\\src': [{ name: 'Core', path: 'D:\\p\\src\\Core', isDir: true }]
  }
  const list = async (dir: string) => tree[dir] ?? []

  it('walks the listings from the root to the folder, matching names without regard to case on Windows', async () => {
    expect(await treeKeysTo('D:/p', ['SRC', 'core'], list, true)).toEqual(['D:\\p\\src', 'D:\\p\\src\\Core'])
    expect(await treeKeysTo('D:/p', [], list, true)).toEqual([])
  })

  it('is null when a name is not a folder there', async () => {
    expect(await treeKeysTo('D:/p', ['README.md'], list, true)).toBeNull()
    expect(await treeKeysTo('D:/p', ['nope'], list, true)).toBeNull()
    expect(await treeKeysTo('D:/p', ['SRC'], list, false)).toBeNull()
  })

  it('is null when a listing fails', async () => {
    expect(
      await treeKeysTo('D:/p', ['src'], async () => {
        throw new Error('EACCES')
      }, true)
    ).toBeNull()
  })
})
