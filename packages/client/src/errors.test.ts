import { describe, it, expect } from 'vitest'
import { AsteraError, ERROR_CODES, EXIT_CODES, REMOTE_ERROR_CODES, codeForStatus, exitCodeFor, remoteCodeOf } from './index.js'

// The codes are the CLI's and MCP's (public CLI design §7-§8, remote runtime design §3.10); the SDK throws the same.
describe('the error contract', () => {
  it('has one exit code per code, the public CLI table', () => {
    expect(Object.keys(EXIT_CODES).sort()).toEqual([...ERROR_CODES].sort())
    expect(exitCodeFor('INVALID_ARGUMENTS')).toBe(2)
    expect(exitCodeFor('HOST_NOT_RUNNING')).toBe(3)
    expect(exitCodeFor('VERSION_MISMATCH')).toBe(9)
    expect(exitCodeFor('RUNTIME_OFFLINE')).toBe(3)
    expect(exitCodeFor('REMOTE_REPLY_TOO_LARGE')).toBe(1)
  })

  it('maps a Host status to a code and guesses nothing else', () => {
    expect([400, 403, 404, 409, 501, 500, 418].map(codeForStatus)).toEqual([
      'INVALID_ARGUMENTS', 'PERMISSION_DENIED', 'NOT_FOUND', 'CONFLICT', 'VERSION_MISMATCH', 'FAILED', 'FAILED'
    ])
  })

  it('reads a remote code from the field, never the sentence', () => {
    expect(remoteCodeOf({ code: 'RUNTIME_BUSY' })).toBe('RUNTIME_BUSY')
    expect(remoteCodeOf({ code: 'NOT_FOUND' })).toBeNull()
    expect(remoteCodeOf({ error: 'RUNTIME_BUSY' })).toBeNull()
    expect(REMOTE_ERROR_CODES.every((c) => ERROR_CODES.includes(c))).toBe(true)
  })

  it('AsteraError carries the code and the details', () => {
    const e = new AsteraError('NOT_FOUND', 'no such job', { id: 'job_1' })
    expect(e).toBeInstanceOf(Error)
    expect([e.name, e.code, e.message, e.details]).toEqual(['AsteraError', 'NOT_FOUND', 'no such job', { id: 'job_1' }])
    expect('details' in new AsteraError('FAILED', 'x')).toBe(false)
  })
})
