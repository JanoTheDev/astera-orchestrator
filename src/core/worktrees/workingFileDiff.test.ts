import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { workingFileDiff } from './detail'

const dir = mkdtempSync(join(tmpdir(), 'wfd-'))
const git = (...a: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir }).toString()
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('workingFileDiff', { timeout: 30_000 }, () => {
  it('shows an uncommitted edit and the content of an uncommitted deletion; none for an untracked file', async () => {
    git('init', '-q')
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    writeFileSync(join(dir, 'gone.txt'), 'removed line\n')
    git('add', '-A')
    git('commit', '-qm', 'init')
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    unlinkSync(join(dir, 'gone.txt'))
    writeFileSync(join(dir, 'new.txt'), 'x\n')
    expect((await workingFileDiff(dir, 'a.txt', null))!.diff).toContain('+two')
    expect((await workingFileDiff(dir, 'gone.txt', null))!.diff).toContain('-removed line')
    expect(await workingFileDiff(dir, 'new.txt', null)).toBeNull()
  })
})
