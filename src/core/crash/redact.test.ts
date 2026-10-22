import { describe, it, expect } from 'vitest'
import { redact } from './redact'

describe('redact', () => {
  it('removes API keys and tokens', () => {
    const cases = [
      'sk-ant-oat01-AbCdEf0123456789AbCdEf0123456789',
      'sk-proj-AbCdEf0123456789AbCdEf',
      'ghp_AbCdEf0123456789AbCdEf0123456789abcd',
      'gho_AbCdEf0123456789AbCdEf0123',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
      'xoxb-1234567890-0987654321-AbCdEfGhIjKlMn',
      'xapp-1-A0123-0123456789-abcdef0123'
    ]
    for (const c of cases) {
      const out = redact(`token ${c} end`)
      expect(out).not.toContain(c)
      expect(out).toContain('[redacted]')
      expect(out).toMatch(/^token .* end$/)
    }
  })

  it('removes a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(redact(`auth ${jwt}`)).toBe('auth [redacted]')
  })

  it('removes a bearer header value', () => {
    expect(redact('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer [redacted]')
    expect(redact('authorization: bearer xyz')).toBe('authorization: bearer [redacted]')
  })

  it('removes key=value secrets', () => {
    expect(redact('url token=abc123&x=1')).not.toContain('abc123')
    expect(redact('password: hunter2')).not.toContain('hunter2')
  })

  it('removes email addresses', () => {
    expect(redact('by jane.doe+x@example.co.uk at')).toBe('by [email] at')
  })

  it('turns home directories into ~', () => {
    expect(redact('at f (/home/jane/proj/a.ts:1:2)')).toBe('at f (~/proj/a.ts:1:2)')
    expect(redact('at /Users/jane/x.js')).toBe('at ~/x.js')
    expect(redact('at C:\\Users\\Jane Doe\\x.js')).toBe('at ~\\x.js')
    expect(redact('at file:///home/jane/app/out/main.js:3:4')).toBe('at file://~/app/out/main.js:3:4')
    expect(redact('cwd /srv/me/x', '/srv/me')).toBe('cwd ~/x')
  })

  it('drops query strings from URLs', () => {
    expect(redact('at http://localhost:5173/src/App.tsx?t=123&k=secret:4:5')).toBe(
      'at http://localhost:5173/src/App.tsx?[redacted]'
    )
  })

  it('removes long opaque strings', () => {
    const blob = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'
    expect(redact(`x ${blob} y`)).toBe('x [redacted] y')
  })

  it('leaves ordinary stack frames alone', () => {
    const frame = 'at Object.handleCommand (~/out/main/index.js:120:7)'
    expect(redact(frame)).toBe(frame)
  })
})
