import { describe, expect, it } from 'vitest'
import { byteLength, editorState, MAX_INSTRUCTION_BYTES, overCap, saveFailure } from './instructionsLogic'

describe('instructions editor', () => {
  it('counts UTF-8 bytes, so a Korean character is three', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('한')).toBe(3)
    expect(overCap('a'.repeat(MAX_INSTRUCTION_BYTES))).toBe(false)
    expect(overCap('a'.repeat(MAX_INSTRUCTION_BYTES + 1))).toBe(true)
  })
  it('saves only a changed text that fits', () => {
    expect(editorState('x', 'x')).toEqual({ dirty: false, tooLong: false, canSave: false })
    expect(editorState('y', 'x')).toEqual({ dirty: true, tooLong: false, canSave: true })
    expect(editorState('abc', '', 2)).toEqual({ dirty: true, tooLong: true, canSave: false })
  })
  it('reads a failed save', () => {
    expect(saveFailure({ ok: true })).toBeNull()
    expect(saveFailure({ ok: false, error: 'too-long', max: 8192 })).toEqual({ key: 'tooLong', max: 8192 })
    expect(saveFailure({ ok: false, error: 'write-failed', message: 'EACCES' })).toEqual({ key: 'writeFailed', detail: 'EACCES' })
    expect(saveFailure({ ok: false, error: 'invalid-role' })).toEqual({ key: 'invalid' })
  })
})
