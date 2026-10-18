// W9-K: one window per project (DESIGN.md §1a).
import { describe, it, expect } from 'vitest'
import {
  createWindowSet,
  newWindowArgOf,
  projectArgOf,
  resolveProjectArg,
  restoreList,
  savedWindowsOf,
  type ProjectWindow,
  type SavedWindows
} from './windows'

class FakeWindow implements ProjectWindow {
  static next = 1
  readonly id = FakeWindow.next++
  destroyed = false
  minimized = false
  focused = 0
  title = ''
  sent: [string, unknown][] = []
  webContents = { send: (c: string, p: unknown) => void this.sent.push([c, p]) }
  isDestroyed = (): boolean => this.destroyed
  isMinimized = (): boolean => this.minimized
  isMaximized = (): boolean => false
  restore = (): void => void (this.minimized = false)
  show = (): void => {}
  focus = (): void => void this.focused++
  setTitle = (t: string): void => void (this.title = t)
  getNormalBounds = () => ({ x: 10, y: 20, width: 800, height: 600 })
}

function setup(saved: SavedWindows = { open: [], places: {} }) {
  let file = saved
  const made: { projectId: string | null; place: unknown; win: FakeWindow }[] = []
  const set = createWindowSet<FakeWindow>({
    create: (projectId, place) => {
      const win = new FakeWindow()
      made.push({ projectId, place, win })
      return win
    },
    read: () => file,
    write: (s) => void (file = s)
  })
  return { set, made, file: () => file }
}

describe('the window set', () => {
  it('opens a window per project, and opening an open project focuses its window', () => {
    const { set, made } = setup()
    const a = set.open('a')
    const b = set.open('b')
    expect(made.map((m) => m.projectId)).toEqual(['a', 'b'])
    a.minimized = true
    expect(set.open('a')).toBe(a)
    expect(made).toHaveLength(2)
    expect(a.focused).toBe(1)
    expect(a.minimized).toBe(false)
    expect(set.all()).toEqual([a, b])
  })

  it('always makes a new All window', () => {
    const { set, made } = setup()
    set.open(null)
    set.open(null)
    expect(made).toHaveLength(2)
  })

  it('sends a push to every window', () => {
    const { set } = setup()
    const a = set.open('a')
    const b = set.open(null)
    set.broadcast('orch:state', { n: 1 })
    expect(a.sent).toEqual([['orch:state', { n: 1 }]])
    expect(b.sent).toEqual([['orch:state', { n: 1 }]])
  })

  it('keeps sending to the others when one window throws or is gone', () => {
    const { set } = setup()
    const a = set.open('a')
    const b = set.open('b')
    const c = set.open('c')
    a.webContents.send = () => {
      throw new Error('gone')
    }
    b.destroyed = true
    set.broadcast('x', 1)
    expect(c.sent).toEqual([['x', 1]])
  })

  it('closing the last window keeps it in the open list (a quit; the Host keeps running), any other close forgets it', () => {
    const { set, file } = setup()
    const a = set.open('a')
    const b = set.open('b')
    expect(file().open).toEqual(['a', 'b'])
    a.destroyed = true
    set.closed(a, false)
    expect(file().open).toEqual(['b'])
    b.destroyed = true
    set.closed(b, false)
    expect(file().open).toEqual(['b'])
    expect(set.all()).toEqual([])
  })

  it('a quit keeps every window in the open list', () => {
    const { set, file } = setup()
    const a = set.open('a')
    set.open('b')
    a.destroyed = true
    set.closed(a, true)
    expect(file().open).toEqual(['a', 'b'])
  })

  it('saves where a project window was and opens it there next time', () => {
    const { set, made, file } = setup()
    const a = set.open('a')
    set.closing(a)
    expect(file().places.a).toEqual({ bounds: { x: 10, y: 20, width: 800, height: 600 }, maximized: false })
    a.destroyed = true
    set.closed(a, false)
    set.open('a')
    expect(made[1].place).toEqual(file().places.a)
  })

  it('a renderer switching project rebinds its window, retitles it and saves the list', () => {
    const { set, file } = setup()
    const w = set.open(null)
    set.setScope(w, { projectId: 'g', name: 'gameful', sessionIds: ['s1'] })
    expect(w.title).toBe('gameful — Astera')
    expect(set.projectOf(w)).toBe('g')
    expect(file().open).toEqual(['g'])
    expect(set.open('g')).toBe(w)
    set.setScope(w, { projectId: null, sessionIds: null })
    expect(w.title).toBe('Astera')
  })

  it("a notice opens the window showing its session, else an All window, else the last focused", () => {
    const { set } = setup()
    const a = set.open('a')
    const b = set.open('b')
    set.setScope(a, { projectId: 'a', name: 'A', sessionIds: ['s1'] })
    set.setScope(b, { projectId: 'b', name: 'B', sessionIds: ['s2'] })
    expect(set.forSession('s2')).toBe(b)
    set.noteFocus(a)
    expect(set.forSession('s9')).toBe(a)
    expect(set.forSession(undefined)).toBe(a)
    const all = set.open(null)
    expect(set.forSession('s9')).toBe(all)
    expect(set.forSession('s1')).toBe(a)
  })
})

describe('launch arguments', () => {
  it('reads --project in both spellings, and --new-window', () => {
    expect(projectArgOf(['/opt/Astera/astera', '--project', 'gameful'])).toBe('gameful')
    expect(projectArgOf(['astera', '--no-sandbox', '--project=../repo'])).toBe('../repo')
    expect(projectArgOf(['astera', '--project', '--new-window'])).toBeNull()
    expect(projectArgOf(['astera'])).toBeNull()
    expect(newWindowArgOf(['astera', '--new-window'])).toBe(true)
  })

  const projects = [
    { id: 'p1', name: 'gameful', path: '/repos/gameful' },
    { id: 'p2', name: 'Astera', path: '/repos/astera' },
    { id: 'p3', name: 'inner', path: '/repos/astera/packages/inner' }
  ]
  it('binds a project by id, name or folder', () => {
    expect(resolveProjectArg('p2', '/', projects)).toBe('p2')
    expect(resolveProjectArg('astera', '/', projects)).toBe('p2')
    expect(resolveProjectArg('/repos/gameful', '/', projects)).toBe('p1')
    expect(resolveProjectArg('src/main', '/repos/gameful', projects)).toBe('p1')
    expect(resolveProjectArg('.', '/repos/astera/packages/inner/src', projects)).toBe('p3')
    expect(resolveProjectArg('/repos/gameful-old', '/', projects)).toBeNull()
    expect(resolveProjectArg('nope', '/tmp', projects)).toBeNull()
  })
})

describe('the restore list', () => {
  it('brings back the saved windows whose project still exists, each project once', () => {
    expect(restoreList({ open: ['a', null, 'gone', 'a', 'b'], places: {} }, ['a', 'b'])).toEqual(['a', null, 'b'])
  })
  it('opens one All window when nothing is left', () => {
    expect(restoreList({ open: ['gone'], places: {} }, [])).toEqual([null])
    expect(restoreList(savedWindowsOf(undefined), [])).toEqual([null])
  })
  it('reads a malformed file as nothing saved', () => {
    expect(savedWindowsOf({ open: [1, 'a', null], places: { a: { bounds: { x: 1 } }, b: { bounds: { x: 0, y: 0, width: 5, height: 5 }, maximized: true } } })).toEqual({
      open: ['a', null],
      places: { b: { bounds: { x: 0, y: 0, width: 5, height: 5 }, maximized: true } }
    })
  })
})
