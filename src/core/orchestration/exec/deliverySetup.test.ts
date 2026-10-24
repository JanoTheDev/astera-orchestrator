// T32: the folder reader behind `projects.deliverySetup` and the Host's delivery fallback.
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFolderSetup } from './deliverySetup'
import { deliveryChoicesOf, effectiveDelivery } from '../deliveryChoices'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'astera-dsetup-'))
  dirs.push(d)
  return d
}
const git = (cwd: string, ...args: string[]): void => void execFileSync('git', args, { cwd, stdio: 'ignore' })
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('readFolderSetup', () => {
  it('reads a folder that is not a git repository', async () => {
    const s = await readFolderSetup(tmp(), true)
    expect(s).toEqual({ isGitRepo: false, remoteUrl: null, ghSignedIn: true, branch: null })
    expect(effectiveDelivery('pr', deliveryChoicesOf(s))).toEqual({ mode: 'manual', reason: 'notGitHub' })
  })

  it('reads a repository with no remote: a pull request falls back to merge', async () => {
    const d = tmp()
    git(d, 'init', '-b', 'trunk')
    const s = await readFolderSetup(d, true)
    expect(s).toMatchObject({ isGitRepo: true, remoteUrl: null, branch: 'trunk' })
    expect(effectiveDelivery('pr', deliveryChoicesOf(s))).toEqual({ mode: 'merge', reason: 'notGitHub' })
  })

  it('reads a GitHub remote, and a pull request needs gh signed in', async () => {
    const d = tmp()
    mkdirSync(d, { recursive: true })
    git(d, 'init', '-b', 'main')
    git(d, 'remote', 'add', 'origin', 'https://github.com/o/r.git')
    const on = await readFolderSetup(d, true)
    expect(on.remoteUrl).toBe('https://github.com/o/r.git')
    expect(effectiveDelivery('pr', deliveryChoicesOf(on))).toEqual({ mode: 'pr' })
    expect(effectiveDelivery('pr', deliveryChoicesOf(await readFolderSetup(d, false)))).toEqual({ mode: 'merge', reason: 'ghSignedOut' })
  })
})
