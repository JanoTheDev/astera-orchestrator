import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rememberMachine } from '../../cli/machineMigrate'
import { createMigrationRunner } from './migration'

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe('createMigrationRunner', () => {
  const setup = () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'astera-migration-'))
    const ssh: string[][] = []
    const runner = createMigrationRunner({
      remote: { list: async () => [{ runtimeId: 'rt_1', name: 'vps' }] as never, client: async () => ({ code: 'RUNTIME_NOT_FOUND', message: 'x' }) as never },
      profileDir: dir,
      exec: async (_f, args) => (ssh.push(args), { code: 0, stdout: '', stderr: '' }),
      local: async (file, args) => ({ code: 0, stdout: file === 'git' && args[2] === 'user.name' ? 'Octo\n' : '', stderr: '' })
    })
    return { runner, ssh, dir }
  }

  it('reaches only a machine whose SSH address was recorded, and moves without asking again (the button is the yes)', async () => {
    const { runner, ssh, dir } = setup()
    expect(await runner.plan('rt_1', {})).toMatchObject({ ok: false })
    await rememberMachine(dir, 'rt_1', { target: 'me@vps', port: 2222, os: 'linux' })
    expect(await runner.machines()).toEqual(['rt_1'])
    const plan = await runner.plan('rt_1', { only: ['git'] })
    expect(plan).toEqual({ ok: true, plan: [expect.objectContaining({ kind: 'git', label: 'git Octo' })] })
    const seen: string[] = []
    const r = await runner.migrate('rt_1', { only: ['git'] }, (x) => seen.push(x.state))
    expect(r.results).toEqual([expect.objectContaining({ state: 'ok' })])
    expect(seen).toEqual(['running', 'ok'])
    expect(ssh[0]).toEqual(expect.arrayContaining(['-p', '2222', 'me@vps', "git config --global user.name 'Octo'"]))
  })
})
