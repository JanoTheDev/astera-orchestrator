import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tempDir } from './testRepo'
import { detectSetupCommand, runWorktreeSetup } from './setup'

const withFiles = async (...names: string[]): Promise<string> => {
  const dir = await tempDir('astera-setup-')
  for (const n of names) await fs.writeFile(path.join(dir, n), '')
  return dir
}

describe('detectSetupCommand', () => {
  it.each([
    [['bun.lock'], 'bun install --frozen-lockfile'],
    [['bun.lockb'], 'bun install --frozen-lockfile'],
    [['pnpm-lock.yaml'], 'pnpm install --frozen-lockfile'],
    [['yarn.lock'], 'yarn install --frozen-lockfile'],
    [['package-lock.json'], 'npm ci'],
    [['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock'], 'bun install --frozen-lockfile'],
    [['package-lock.json', 'yarn.lock'], 'yarn install --frozen-lockfile'],
    [[], null]
  ])('%j -> %s', async (files, want) => {
    expect(await detectSetupCommand(await withFiles(...files))).toBe(want)
  })
})

describe('runWorktreeSetup', () => {
  const logs: string[] = []
  const log = (m: string): void => void logs.push(m)

  it('runs the given command in the worktree', async () => {
    const dir = await withFiles()
    const r = await runWorktreeSetup({ dir, setting: 'touch ran.txt', log })
    expect(r).toMatchObject({ ran: true, ok: true, command: 'touch ran.txt' })
    await expect(fs.access(path.join(dir, 'ran.txt'))).resolves.toBeUndefined()
  })

  it('off runs nothing, even with a lockfile', async () => {
    const dir = await withFiles('package-lock.json')
    expect(await runWorktreeSetup({ dir, setting: 'off', log })).toMatchObject({ ran: false })
  })

  it('runs nothing with no setting and no lockfile', async () => {
    expect(await runWorktreeSetup({ dir: await withFiles(), log })).toMatchObject({ ran: false, command: null })
  })

  it('skips when node_modules is already there', async () => {
    const dir = await withFiles()
    await fs.mkdir(path.join(dir, 'node_modules'))
    expect(await runWorktreeSetup({ dir, setting: 'touch ran.txt', log })).toMatchObject({ ran: false })
    await expect(fs.access(path.join(dir, 'ran.txt'))).rejects.toThrow()
  })

  it('reports a failing command with its output, never throws', async () => {
    logs.length = 0
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'echo boom; exit 3', log })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('exit 3')
    expect(r.tail).toContain('boom')
    expect(logs.join('\n')).toContain('echo boom; exit 3')
  })

  it('reports a missing tool', async () => {
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'astera-no-such-tool-xyz', log })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('127')
  })

  it('reports a timeout and ends the command', async () => {
    const t = Date.now()
    const r = await runWorktreeSetup({ dir: await withFiles(), setting: 'sleep 30', log, timeoutMs: 200 })
    expect(r).toMatchObject({ ran: true, ok: false })
    expect(r.tail).toContain('timed out')
    expect(Date.now() - t).toBeLessThan(5000)
  })
})
