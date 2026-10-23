import { describe, expect, it } from 'vitest'
import { scopeAfterProbe } from './useJobs'

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
