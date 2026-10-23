import { describe, expect, it } from 'vitest'
import { scopeAfterProbe, selectionAfterDrop } from './useJobs'

const gone = new Error("Error invoking remote method 'files.list': Error: ENOENT: no such file or directory, scandir '/tmp/gone'")

describe('scopeAfterProbe', () => {
  it('drops a selected project whose folder is gone', () => {
    expect(scopeAfterProbe('/tmp/gone', '/tmp/gone', gone)).toBeNull()
  })

  it('keeps a selection that moved on while the probe ran', () => {
    expect(scopeAfterProbe('/tmp/other', '/tmp/gone', gone)).toBe('/tmp/other')
  })

  it('keeps the project on an error that is not a missing folder', () => {
    expect(scopeAfterProbe('/tmp/p', '/tmp/p', new Error('EACCES: permission denied'))).toBe('/tmp/p')
  })
})

// The top bar's selection after the folder `droppedRoot` is gone: the fallback project (currentProject), or All.
describe('selectionAfterDrop', () => {
  const tree = [
    { id: 'g', path: '/repos/gameful' },
    { id: 'a', path: '/repos/astera' }
  ]

  it('moves a selection on the gone folder to the project the app falls back to', () => {
    expect(selectionAfterDrop('g', tree, '/repos/gameful', '/repos/astera')).toBe('a')
  })

  it('moves it to All projects when the fallback is no project in the tree', () => {
    expect(selectionAfterDrop('g', tree, '/repos/gameful', '/tmp/scratch')).toBeNull()
    expect(selectionAfterDrop('g', tree, '/repos/gameful', null)).toBeNull()
  })

  it('keeps a selection on another project, and All projects', () => {
    expect(selectionAfterDrop('a', tree, '/repos/gameful', '/repos/astera')).toBe('a')
    expect(selectionAfterDrop(null, tree, '/repos/gameful', '/repos/astera')).toBeNull()
  })

  it('keeps the selection when nothing was dropped', () => {
    expect(selectionAfterDrop('g', tree, null, '/repos/astera')).toBe('g')
  })
})
