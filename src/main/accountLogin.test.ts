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

describe('accountLoginHandlers, opened again right after a cancel (#82)', () => {
  it('waits for the cancelled run to exit instead of answering BUSY', async () => {
    const procs = [fakeProc(), fakeProc()]
    let n = 0
    const h = accountLoginHandlers({ account: () => account, run: () => procs[n++], loggedIn: async () => true })
    const first = h.login('a1')
    h.cancelLogin()
    const second = h.login('a1')
    await expect(first).resolves.toEqual({ ok: false, reason: 'cancelled' })
    procs[1].exit(0)
    await expect(second).resolves.toEqual({ ok: true })
  })
})

// T3 (account center sync): the row learns of an in-app sign-in from main, not from a window focus the
// paste-the-code flow never causes.
describe('accountLoginHandlers, telling the account center (T3)', () => {
  it('calls onFinished once the CLI has exited, after the login check, success or not', async () => {
    const order: string[] = []
    const proc = fakeProc()
    const h = accountLoginHandlers({
      account: () => account,
      run: () => proc,
      loggedIn: async () => (order.push('checked'), true),
      onFinished: (id) => void order.push(`finished:${id}`)
    })
    const done = h.login('a1')
    expect(order).toEqual([])
    proc.exit(0)
    await expect(done).resolves.toEqual({ ok: true })
    expect(order).toEqual(['checked', 'finished:a1'])

    const failed = fakeProc()
    const h2 = accountLoginHandlers({ account: () => account, run: () => failed, loggedIn: async () => false, onFinished: (id) => void order.push(`finished:${id}`) })
    const done2 = h2.login('a1')
    h2.cancelLogin()
    await expect(done2).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(order).toEqual(['checked', 'finished:a1', 'finished:a1'])
  })

  it('a throwing onFinished does not fail the sign-in', async () => {
    const proc = fakeProc()
    const h = accountLoginHandlers({ account: () => account, run: () => proc, loggedIn: async () => true, onFinished: () => { throw new Error('boom') } })
    const done = h.login('a1')
    proc.exit(0)
    await expect(done).resolves.toEqual({ ok: true })
  })
})
