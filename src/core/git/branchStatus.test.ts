import { describe, it, expect } from 'vitest'
import { parseBranchStatus } from './branchStatus'

describe('parseBranchStatus', () => {
  it('reads the branch, the changed paths and the distance to the upstream', () => {
    const out = [
      '# branch.oid 1234567890abcdef1234567890abcdef12345678',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -5',
      '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts\tsrc/old.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts',
      '? notes.md',
      '! dist/out.js',
      ''
    ].join('\n')
    expect(parseBranchStatus(out)).toEqual({ branch: 'main', dirty: 4, unpushed: 2, behind: 5 })
  })

  it('a clean branch without an upstream knows neither ahead nor behind', () => {
    expect(parseBranchStatus('# branch.oid abc\n# branch.head feature/x\n')).toEqual({ branch: 'feature/x', dirty: 0, unpushed: null, behind: null })
  })

  it('names a detached HEAD by its short commit, and an empty repository by nothing', () => {
    expect(parseBranchStatus('# branch.oid 1234567890abcdef\n# branch.head (detached)\n').branch).toBe('1234567')
    expect(parseBranchStatus('# branch.oid (initial)\n# branch.head (detached)\n').branch).toBeNull()
    expect(parseBranchStatus('# branch.oid (initial)\n# branch.head main\n? a\n')).toEqual({ branch: 'main', dirty: 1, unpushed: null, behind: null })
  })

  it('a path that starts like a header is still one change', () => {
    expect(parseBranchStatus('# branch.head main\n? # branch.ab +9 -9\n').dirty).toBe(1)
  })
})
