import { describe, expect, it } from 'vitest'
import { createLoginTerminal } from './loginTerminal'

describe('createLoginTerminal (T12b)', () => {
  const opened: Array<{ id: string; file: string; args: string[] | string; opts: { env: Record<string, string | undefined> }; meta?: { kind: string; id: string } }> = []
  const registry = { open: (a: (typeof opened)[number]) => (opened.push(a), { ok: true as const, pid: 1 }) }

  it('opens a session pty running the CLI\'s accounts login --new, without the Host\'s own variables', () => {
    const start = createLoginTerminal({ registry: registry as never, cli: { exec: '/app/astera', entry: '/app/cli.js' }, profileDir: '/p', home: '/h', env: { PATH: '/bin', ASTERA_HOST_LOG: 'x' }, log: () => {} })
    const r = start()
    expect(r.ok).toBe(true)
    const o = opened[0]
    expect([o.file, o.args]).toEqual(['/app/astera', ['/app/cli.js', 'accounts', 'login', '--new']])
    expect(o.meta).toMatchObject({ kind: 'session', id: o.id })
    expect(o.opts.env).toMatchObject({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', ASTERA_PROFILE_DIR: '/p' })
    expect(o.opts.env.ASTERA_HOST_LOG).toBeUndefined()
    expect(r.ok && r.session).toMatchObject({ id: o.id, ptyId: o.id, kind: 'terminal', alive: true })
  })

  it('refuses when the Host has no CLI paths', () => {
    expect(createLoginTerminal({ registry: registry as never, cli: null, profileDir: '/p', home: '/h', env: {}, log: () => {} })()).toMatchObject({ ok: false })
  })
})
