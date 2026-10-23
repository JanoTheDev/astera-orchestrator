import { describe, expect, it } from 'vitest'
import { errText } from './useFileOps'

describe('errText', () => {
  it('keeps only the reason of a failed files.list (the Files explorer "Read failed" note)', () => {
    const err = new Error("Error invoking remote method 'files.list': Error: ENOENT: no such file or directory, scandir '/tmp/gone'")
    expect(errText(err)).toBe("ENOENT: no such file or directory, scandir '/tmp/gone'")
  })
  it('passes a message without the prefix through', () => {
    expect(errText(new Error('EACCES'))).toBe('EACCES')
    expect(errText('plain')).toBe('plain')
  })
})
