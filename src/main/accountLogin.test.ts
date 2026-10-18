import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({}))
import { accountLoginHandlers, type LoginProc } from './accountLogin'
import type { Account } from '../core/types'

const account: Account = { id: 'a1', label: 'A', configDir: '/tmp/a1', color: '#fff', createdAt: '2026-10-18T00:00:00Z' }

function fakeProc(): LoginProc & { say(s: string): void; exit(code: number): void; written: string[]; killed: boolean } {
  let out: (c: string) => void = () => {}
  let done!: (c: number) => void
  const p = {
    written: [] as string[],
    killed: false,
    onOutput: (cb: (c: string) => void) => void (out = cb),
    exited: new Promise<number>((r) => (done = r)),
    write: (l: string) => void p.written.push(l),
    kill: () => {
      p.killed = true
      done(143)
    },
    say: (s: string) => out(s),
    exit: (c: number) => done(c)
  }
  return p
}

describe('accountLoginHandlers (#82)', () => {
  it('shows the link, passes the pasted code on, and answers ok once the folder is logged in', async () => {
    const proc = fakeProc()
    let loggedIn = false
    const h = accountLoginHandlers({ account: () => account, run: () => proc, loggedIn: async () => loggedIn })
    const done = h.login('a1')
    proc.say('visit: https://claude.com/cai/oauth/authorize?state=s\nPaste code here if prompted > ')
    expect(h.loginState()).toEqual({ id: 'a1', url: 'https://claude.com/cai/oauth/authorize?state=s', asksCode: true })
    await expect(h.login('a1')).rejects.toThrow(/BUSY/)
    h.loginCode(' c0de ')
    expect(proc.written).toEqual(['c0de\n'])
    loggedIn = true
    proc.exit(0)
    await expect(done).resolves.toEqual({ ok: true })
    expect(h.loginState()).toBeNull()
  })
  it('cancels, and never repeats the link in a failure message', async () => {
    const proc = fakeProc()
    const h = accountLoginHandlers({ account: () => account, run: () => proc, loggedIn: async () => false })
    const done = h.login('a1')
    h.cancelLogin()
    await expect(done).resolves.toEqual({ ok: false, reason: 'cancelled' })

    const p2 = fakeProc()
    const h2 = accountLoginHandlers({ account: () => account, run: () => p2, loggedIn: async () => false })
    const d2 = h2.login('a1')
    p2.say('visit: https://x.example/?state=secret\nOAuth error: bad code https://x.example/?state=secret\n')
    p2.exit(1)
    const r = await d2
    expect(r.ok).toBe(false)
    expect(r.message).not.toContain('secret')
  })
})
