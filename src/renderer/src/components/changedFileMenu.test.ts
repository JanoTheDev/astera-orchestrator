import { describe, expect, it, vi } from 'vitest'
import type { MenuItem } from './ui/Menu'
import { absoluteOf, changedFileLabels, changedFileMenu, type ChangedFileHandlers } from './changedFileMenu'

const label = { open: 'open', diff: 'diff', copyPath: 'copyPath', copyRelative: 'copyRelative', reveal: 'reveal' }
const target = (status: 'added' | 'modified' | 'deleted' | 'renamed' | 'new' | 'conflict') => ({ status, path: '/p/src/a.ts', relative: 'src/a.ts' })
const handlers = (): ChangedFileHandlers => ({ open: vi.fn(), diff: vi.fn(), copy: vi.fn(), reveal: vi.fn() })
const itemsOf = (items: ReturnType<typeof changedFileMenu>): MenuItem[] => items.filter((x): x is MenuItem => x !== 'separator')
const byId = (items: MenuItem[], id: string): MenuItem => items.find((x) => x.id === id)!

describe('changedFileMenu', () => {
  it.each(['modified', 'added', 'renamed', 'new', 'conflict'] as const)('%s file: every item is on', (status) => {
    const items = itemsOf(changedFileMenu(target(status), label, handlers()))
    expect(items.map((x) => x.id)).toEqual(['open', 'diff', 'copyPath', 'copyRelative', 'reveal'])
    expect(items.every((x) => !x.disabled)).toBe(true)
  })

  it('deleted file: Open and Reveal are off, Diff and the copies stay on', () => {
    const items = itemsOf(changedFileMenu(target('deleted'), label, handlers()))
    expect(byId(items, 'open').disabled).toBe(true)
    expect(byId(items, 'reveal').disabled).toBe(true)
    expect(byId(items, 'diff').disabled).toBeFalsy()
    expect(byId(items, 'copyPath').disabled).toBeFalsy()
    expect(byId(items, 'copyRelative').disabled).toBeFalsy()
  })

  it('each item calls its own handler with the right path', () => {
    const h = handlers()
    const items = itemsOf(changedFileMenu(target('modified'), label, h))
    byId(items, 'open').onSelect()
    byId(items, 'diff').onSelect()
    byId(items, 'copyPath').onSelect()
    byId(items, 'copyRelative').onSelect()
    byId(items, 'reveal').onSelect()
    expect(h.open).toHaveBeenCalledWith('/p/src/a.ts')
    expect(h.diff).toHaveBeenCalledOnce()
    expect(h.copy).toHaveBeenNthCalledWith(1, '/p/src/a.ts')
    expect(h.copy).toHaveBeenNthCalledWith(2, 'src/a.ts')
    expect(h.reveal).toHaveBeenCalledWith('/p/src/a.ts')
  })

  it('labels come from the label map', () => {
    expect(itemsOf(changedFileMenu(target('added'), label, handlers())).map((x) => x.label)).toEqual(['open', 'diff', 'copyPath', 'copyRelative', 'reveal'])
  })

  it('picks the Mac or the other reveal wording', () => {
    const t = (key: string): string => key
    expect(changedFileLabels(t as never, true).reveal).toBe('explorer.menu.revealMac')
    expect(changedFileLabels(t as never, false).reveal).toBe('explorer.menu.reveal')
  })
})

describe('absoluteOf', () => {
  it('joins a root and a git path, dropping a trailing separator on the root', () => {
    expect(absoluteOf('/wt/a', 'src/x.ts')).toBe('/wt/a/src/x.ts')
    expect(absoluteOf('/wt/a/', 'src/x.ts')).toBe('/wt/a/src/x.ts')
  })

  it('uses a Windows root\'s backslash and converts the git path to it', () => {
    expect(absoluteOf('C:\\wt', 'src/x.ts')).toBe('C:\\wt\\src\\x.ts')
    expect(absoluteOf('C:\\wt\\', 'a/b/x.ts')).toBe('C:\\wt\\a\\b\\x.ts')
  })

  it('keeps forward slashes for a POSIX root, even one holding a backslash', () => {
    expect(absoluteOf('/wt', 'src/x.ts')).toBe('/wt/src/x.ts')
    expect(absoluteOf('/wt/a\\b', 'x.ts')).toBe('/wt/a\\b/x.ts')
  })
})
