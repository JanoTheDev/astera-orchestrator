import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loginNewAccount } from './cliLogin'
import { makeDescriptors } from '../providers/descriptor'

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

const setup = () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astera-cli-login-'))
  const home = path.join(dir, 'home')
  const profileDir = path.join(dir, 'profile')
  // linux: a Claude account is signed in when its folder holds .credentials.json (accounts/loginStatus.ts).
  return { home, profileDir, descriptors: makeDescriptors('linux', home) }
}
const accounts = (profileDir: string): Array<{ label: string; configDir: string; provider?: string }> =>
  JSON.parse(readFileSync(path.join(profileDir, 'accounts.json'), 'utf8')).accounts

describe('loginNewAccount', () => {
  it('registers a fresh folder and runs `claude auth login` with CLAUDE_CONFIG_DIR naming it', async () => {
    const s = setup()
    const calls: Array<{ command: string; args: string[]; env: Record<string, string> }> = []
    const r = await loginNewAccount({ label: 'Work' }, {
      ...s,
      run: async (command, args, env) => {
        calls.push({ command, args, env })
        writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json'), '{}')
        return 0
      }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(calls).toEqual([{ command: 'claude', args: ['auth', 'login'], env: { CLAUDE_CONFIG_DIR: r.account.configDir } }])
    expect(r.account).toMatchObject({ label: 'Work', provider: 'claude', configDir: path.join(s.home, '.claude-accounts', 'work') })
    expect(accounts(s.profileDir)).toEqual([expect.objectContaining({ label: 'Work', configDir: r.account.configDir })])
  })

  it('an account that did not sign in is taken off again', async () => {
    const s = setup()
    const r = await loginNewAccount({}, { ...s, run: async () => 1 })
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/exited with 1/) })
    expect(accounts(s.profileDir)).toEqual([])
  })

  it('a second account gets its own folder', async () => {
    const s = setup()
    const run = async (_c: string, _a: string[], env: Record<string, string>) => (writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json'), '{}'), 0)
    const a = await loginNewAccount({}, { ...s, run })
    const b = await loginNewAccount({}, { ...s, run })
    expect(a.ok && b.ok && a.account.configDir !== b.account.configDir).toBe(true)
    expect(accounts(s.profileDir)).toHaveLength(2)
  })
})
