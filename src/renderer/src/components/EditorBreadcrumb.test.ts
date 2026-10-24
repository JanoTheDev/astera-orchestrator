import { describe, it, expect } from 'vitest'
import { crumbsOf } from './EditorBreadcrumb'

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
