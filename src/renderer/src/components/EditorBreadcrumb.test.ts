import { describe, it, expect } from 'vitest'
import { crumbsOf, relativePathOf } from './EditorBreadcrumb'

describe('crumbsOf', () => {
  it('shows a file inside the project relative to it', () => {
    expect(crumbsOf('/home/me/proj/src/a.ts', '/home/me/proj')).toEqual(['src', 'a.ts'])
    expect(crumbsOf('C:\\work\\proj\\a.ts', 'C:\\work\\proj\\')).toEqual(['a.ts'])
  })

  it('shows the whole path outside the project, or with none', () => {
    expect(crumbsOf('/home/me/projx/a.ts', '/home/me/proj')).toEqual(['home', 'me', 'projx', 'a.ts'])
    expect(crumbsOf('/tmp/a.ts')).toEqual(['tmp', 'a.ts'])
  })
})

describe('relativePathOf', () => {
  it('joins the in-project part with slashes', () => {
    expect(relativePathOf('C:\\work\\proj\\src\\a.ts', 'C:\\work\\proj')).toBe('src/a.ts')
  })
  it('is null outside the project or with no root', () => {
    expect(relativePathOf('/tmp/a.ts', '/home/me/proj')).toBeNull()
    expect(relativePathOf('/tmp/a.ts')).toBeNull()
  })
})
