import { describe, it, expect } from 'vitest'
import { AsteraError, ERROR_CODES, EXIT_CODES, REMOTE_ERROR_CODES, bodyCodeOf, codeForStatus, isAsteraError, remoteCodeOf } from './internal.js'

// The codes are the CLI's and MCP's (public CLI design §7-§8, remote runtime design §3.10); the SDK throws the same.
describe('the error contract', () => {
  it('has one exit code per code, the public CLI table', () => {
    expect(Object.keys(EXIT_CODES).sort()).toEqual([...ERROR_CODES].sort())
    expect(EXIT_CODES['INVALID_ARGUMENTS']).toBe(2)
    expect(EXIT_CODES['HOST_NOT_RUNNING']).toBe(3)
    expect(EXIT_CODES['VERSION_MISMATCH']).toBe(9)
    expect(EXIT_CODES['RUNTIME_OFFLINE']).toBe(3)
    expect(EXIT_CODES['REMOTE_REPLY_TOO_LARGE']).toBe(1)
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

  it('reads a code a refusal names in its body, a remote one or a plugin one, never the sentence (plugin Phase 5 C7)', () => {
    expect(bodyCodeOf({ code: 'PLUGIN_CAPABILITY_MISSING' })).toBe('PLUGIN_CAPABILITY_MISSING')
    expect(bodyCodeOf({ code: 'RUNTIME_BUSY' })).toBe('RUNTIME_BUSY')
    expect(bodyCodeOf({ code: 'NOPE' })).toBeNull()
    expect(bodyCodeOf({ error: 'PLUGIN_CAPABILITY_MISSING' })).toBeNull()
    expect(bodyCodeOf(null)).toBeNull()
    // Its refusal is a 409: it exits as CONFLICT does
    expect(EXIT_CODES['PLUGIN_CAPABILITY_MISSING']).toBe(6)
  })

  it('AsteraError carries the code and the details', () => {
    const e = new AsteraError('NOT_FOUND', 'no such job', { id: 'job_1' })
    expect(e).toBeInstanceOf(Error)
    expect([e.name, e.code, e.message, e.details]).toEqual(['AsteraError', 'NOT_FOUND', 'no such job', { id: 'job_1' }])
    expect('details' in new AsteraError('FAILED', 'x')).toBe(false)
  })
})

// Final review of SDK 1b, Important 4: an application that loads the ESM copy and a dependency that loads the
// CommonJS copy hold two AsteraError classes; instanceof has to hold across them.
describe('AsteraError across two copies of the package', () => {
  it('is an AsteraError by its brand, not by which copy made it', () => {
    const foreign = Object.assign(new Error('x'), { name: 'AsteraError', code: 'NOT_FOUND', [Symbol.for('@astera-app/client/AsteraError')]: true })
    expect(foreign instanceof AsteraError).toBe(true)
    expect(isAsteraError(foreign)).toBe(true)
    expect(isAsteraError(new AsteraError('FAILED', 'x'))).toBe(true)
    expect(new AsteraError('FAILED', 'x') instanceof AsteraError).toBe(true)
  })

  it('is nothing else', () => {
    expect(new Error('x') instanceof AsteraError).toBe(false)
    for (const v of [new Error('x'), null, undefined, 'AsteraError', { code: 'NOT_FOUND' }]) expect(isAsteraError(v)).toBe(false)
  })
})
