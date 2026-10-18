import { describe, it, expect } from 'vitest'
import { projectAnchorOf } from './projectAnchor'

describe('projectAnchorOf (W8-G #104)', () => {
  it('prefers the open project, then a tab, then home, so a window with no tab still has an anchor', () => {
    expect(projectAnchorOf('/p', '/tab', '/home/me')).toBe('/p')
    expect(projectAnchorOf(null, '/tab', '/home/me')).toBe('/tab')
    expect(projectAnchorOf(null, undefined, '/home/me')).toBe('/home/me')
    expect(projectAnchorOf(null, undefined, null)).toBeNull()
  })
})
