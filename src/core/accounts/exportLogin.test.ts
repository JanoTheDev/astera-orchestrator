import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { importAccount, setupTokenCredentials, setupTokenOf, writeLoginFile, type WriteLoginDeps } from './exportLogin'
import { makeDescriptors } from '../providers/descriptor'

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})
const tmp = (): string => (dir = mkdtempSync(path.join(os.tmpdir(), 'astera-export-login-')))
const linux = (runs: Array<{ file: string; args: string[] }> = []): WriteLoginDeps => ({
  platform: 'linux',
  run: async (file, args) => (runs.push({ file, args }), 0),
  user: 'me',
  random: () => 'r1'
})

describe('writeLoginFile', () => {
  it('writes the content byte for byte, mode 0600, and leaves no temp file', async () => {
    const d = tmp()
    await writeLoginFile(d, '.credentials.json', '{"a":1}', linux())
    expect(readFileSync(path.join(d, '.credentials.json'), 'utf8')).toBe('{"a":1}')
    if (process.platform !== 'win32') expect(statSync(path.join(d, '.credentials.json')).mode & 0o777).toBe(0o600)
    expect(readdirSync(d)).toEqual(['.credentials.json'])
  })

  it('on Windows drops inherited access for the user alone, and a failing icacls leaves nothing behind', async () => {
    const d = tmp()
    const runs: Array<{ file: string; args: string[] }> = []
    await writeLoginFile(d, 'auth.json', 'x', { ...linux(runs), platform: 'win32' })
    expect(runs).toEqual([{ file: 'icacls', args: [path.join(d, '.auth.json.r1.tmp'), '/inheritance:r', '/grant:r', 'me:F'] }])
    rmSync(path.join(d, 'auth.json'))
    await expect(writeLoginFile(d, 'auth.json', 'x', { ...linux(), platform: 'win32', run: async () => 5 })).rejects.toThrow(/icacls/)
    expect(readdirSync(d)).toEqual([])
  })
})

describe('setup-token', () => {
  it('finds the token in the screen output and makes a credentials file with no refresh token', () => {
    const tok = `sk-ant-oat01-${'a'.repeat(40)}`
    expect(setupTokenOf(`\x1b[32mYour token:\x1b[0m\n${tok}\nStore it safely`)).toBe(tok)
    expect(setupTokenOf('cancelled')).toBeNull()
    const c = JSON.parse(setupTokenCredentials(tok, 1000)).claudeAiOauth
    expect(c).toEqual({ accessToken: tok, refreshToken: null, expiresAt: 1000 + 365 * 24 * 3600_000, scopes: ['user:inference'] })
  })
})

describe('importAccount', () => {
  it('makes the account with its label, colour and provider, writes its login 0600, and updates it the second time', async () => {
    const d = tmp()
    const home = path.join(d, 'home')
    const deps = { ...linux(), profileDir: path.join(d, 'profile'), home, descriptors: makeDescriptors('linux', home) }
    const first = await importAccount({ label: 'Work', color: '#123456', provider: 'claude', login: '{"claudeAiOauth":{}}\n' }, deps)
    expect(first).toMatchObject({ created: true, signedIn: true, account: { label: 'Work', color: '#123456', provider: 'claude' } })
    const file = path.join(first.account.configDir, '.credentials.json')
    expect(readFileSync(file, 'utf8')).toBe('{"claudeAiOauth":{}}')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    const again = await importAccount({ label: 'Work', provider: 'claude', login: '{"b":2}' }, deps)
    expect(again).toMatchObject({ created: false, account: { id: first.account.id } })
    expect(readFileSync(file, 'utf8')).toBe('{"b":2}')
    const codex = await importAccount({ label: 'Work', provider: 'codex' }, deps)
    expect(codex).toMatchObject({ created: true, signedIn: false, account: { provider: 'codex' } })
  })
})
