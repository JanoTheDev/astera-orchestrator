import { describe, expect, it } from 'vitest'
import { loginCodeOf, loginOutputReader } from './loginUrl'

describe('loginOutputReader (#82)', () => {
  it('reads claude 2.1 auth login output, split across chunks, and its paste prompt', () => {
    const read = loginOutputReader()
    expect(read('Opening browser to sign in…\nIf the browser didn\'t open, visit: https://claude.com/cai/oauth/auth')).toEqual({ url: null, asksCode: false })
    expect(read('orize?code=true&state=s1\nPaste code here if prompted > ')).toEqual({
      url: 'https://claude.com/cai/oauth/authorize?code=true&state=s1',
      asksCode: true
    })
  })
  it('skips codex\'s http callback and takes the https link', () => {
    const read = loginOutputReader()
    read('Starting local login server on http://localhost:1455.\n')
    expect(read('\x1b[1mhttps://auth.openai.com/oauth/authorize?x=1\x1b[0m\n').url).toBe('https://auth.openai.com/oauth/authorize?x=1')
  })
  it('keeps the first link', () => {
    const read = loginOutputReader()
    read('https://a.example/1\n')
    expect(read('https://b.example/2\n').url).toBe('https://a.example/1')
  })
})

describe('loginCodeOf', () => {
  it('takes one trimmed line only', () => {
    expect(loginCodeOf('  abc#def \n')).toBe('abc#def')
    expect(loginCodeOf('a\nb')).toBeNull()
    expect(loginCodeOf('')).toBeNull()
    expect(loginCodeOf(3)).toBeNull()
  })
})
