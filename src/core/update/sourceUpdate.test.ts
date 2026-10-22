import { describe, expect, it } from 'vitest'
import {
  appImagesToDelete,
  BUILD_RETRY_MS,
  BUILT_COMMIT,
  canSelfInstall,
  isUpdateMode,
  lastUsefulLine,
  mayBuild,
  modeActions,
  needsInstall,
  parseCommitLog,
  SOURCE_DIR,
  stagedName
} from './sourceUpdate'

describe('source channel build facts', () => {
  it('are empty under vitest, so the channel is off', () => {
    expect(BUILT_COMMIT).toBe('')
    expect(SOURCE_DIR).toBe('')
  })
})

describe('parseCommitLog', () => {
  it('reads sha and subject per line, keeping tabs inside the subject', () => {
    const sha1 = 'a'.repeat(40)
    const sha2 = 'b'.repeat(40)
    expect(parseCommitLog(`${sha1}\tfix: one\n${sha2}\tfeat: two\twith tab\n\n`)).toEqual([
      { sha: sha1, subject: 'fix: one' },
      { sha: sha2, subject: 'feat: two\twith tab' }
    ])
  })
  it('ignores lines that are not commits', () => {
    expect(parseCommitLog('warning: something\n')).toEqual([])
  })
})

describe('modeActions', () => {
  it('maps each mode to what it does on its own', () => {
    expect(modeActions('off')).toEqual({ check: false, build: false, install: false })
    expect(modeActions('notify')).toEqual({ check: true, build: false, install: false })
    expect(modeActions('build')).toEqual({ check: true, build: true, install: false })
    expect(modeActions('install-when-idle')).toEqual({ check: true, build: true, install: true })
  })
  it('isUpdateMode accepts only the four modes', () => {
    expect(isUpdateMode('build')).toBe(true)
    expect(isUpdateMode('always')).toBe(false)
    expect(isUpdateMode(undefined)).toBe(false)
  })
})

describe('canSelfInstall', () => {
  it('needs Linux and an AppImage', () => {
    expect(canSelfInstall('linux', '/x/a.AppImage')).toBe(true)
    expect(canSelfInstall('linux', undefined)).toBe(false)
    expect(canSelfInstall('darwin', '/x/a.AppImage')).toBe(false)
  })
})

describe('needsInstall', () => {
  it('runs npm ci only when the lockfile hash changed or nothing is installed', () => {
    expect(needsInstall('h1', 'h1', true)).toBe(false)
    expect(needsInstall('h2', 'h1', true)).toBe(true)
    expect(needsInstall('h1', undefined, true)).toBe(true)
    expect(needsInstall('h1', 'h1', false)).toBe(true)
  })
})

describe('mayBuild', () => {
  it('blocks a failed target for six hours, never another target', () => {
    const failed = { abc: 1_000 }
    expect(mayBuild(failed, 'abc', 1_000 + BUILD_RETRY_MS - 1)).toBe(false)
    expect(mayBuild(failed, 'abc', 1_000 + BUILD_RETRY_MS)).toBe(true)
    expect(mayBuild(failed, 'def', 1_001)).toBe(true)
  })
})

describe('boot cleanup', () => {
  it('deletes every AppImage but the kept ones', () => {
    const files = ['astera-1.0.0-aaaaaaa.AppImage', 'astera-1.0.1-bbbbbbb.AppImage', 'astera-1.0.2-ccccccc.AppImage', 'notes.txt']
    expect(appImagesToDelete(files, ['astera-1.0.1-bbbbbbb.AppImage', undefined])).toEqual([
      'astera-1.0.0-aaaaaaa.AppImage',
      'astera-1.0.2-ccccccc.AppImage'
    ])
  })
  it('names a staged build by version and short sha', () => {
    expect(stagedName('1.4.14', '0123456789abcdef')).toBe('astera-1.4.14-0123456.AppImage')
  })
})

describe('lastUsefulLine', () => {
  it('prefers the last error line over trailing noise', () => {
    expect(lastUsefulLine('building\nnpm ERR! code ELIFECYCLE\nnpm ERR! exit 1\n  \n')).toBe('npm ERR! exit 1')
    expect(lastUsefulLine('a\nb\n')).toBe('b')
    expect(lastUsefulLine('')).toBe('')
  })
})
