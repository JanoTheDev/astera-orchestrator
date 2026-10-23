import { describe, expect, it } from 'vitest'
import {
  activeUpdateChannelOf,
  isUpdateChannel,
  UPDATE_IPC_CHANNELS,
  updateChannelOf,
  updateDisabledOf,
  updaterOptionsOf
} from './updateChannel'

describe('updateChannelOf', () => {
  it('reads beta only from an explicit beta, everything else as stable', () => {
    expect(updateChannelOf('beta')).toBe('beta')
    expect(updateChannelOf('stable')).toBe('stable')
    for (const v of [undefined, null, '', 'BETA', 'alpha', 1, true, {}]) expect(updateChannelOf(v)).toBe('stable')
  })
  it('isUpdateChannel accepts the two tracks only', () => {
    expect(isUpdateChannel('stable')).toBe(true)
    expect(isUpdateChannel('beta')).toBe(true)
    expect(isUpdateChannel('alpha')).toBe(false)
    expect(isUpdateChannel(undefined)).toBe(false)
  })
})

describe('updaterOptionsOf', () => {
  it('allows prereleases on beta and turns them off on stable', () => {
    expect(updaterOptionsOf('beta')).toEqual({ allowPrerelease: true })
    expect(updaterOptionsOf('stable')).toEqual({ allowPrerelease: false })
  })
})

describe('activeUpdateChannelOf', () => {
  const base = { packaged: true, autoUpdate: false, builtCommit: '', sourceDir: '' }
  it('runs nothing in a dev run, whatever the build carries', () => {
    expect(activeUpdateChannelOf({ packaged: false, autoUpdate: true, builtCommit: 'abc', sourceDir: '/s' })).toBeNull()
  })
  it('prefers releases over source when a build has both', () => {
    expect(activeUpdateChannelOf({ ...base, autoUpdate: true, builtCommit: 'abc', sourceDir: '/s' })).toBe('releases')
  })
  it('runs source for a git-checkout build without the releases flag', () => {
    expect(activeUpdateChannelOf({ ...base, builtCommit: 'abc', sourceDir: '/s' })).toBe('source')
    expect(activeUpdateChannelOf({ ...base, builtCommit: 'abc' })).toBeNull()
  })
  it('runs nothing for a packaged build with neither', () => {
    expect(activeUpdateChannelOf(base)).toBeNull()
  })
})

describe('updateDisabledOf', () => {
  it('names why no channel runs', () => {
    expect(updateDisabledOf(false)).toEqual({ state: 'disabled', reason: 'unpackaged' })
    expect(updateDisabledOf(true)).toEqual({ state: 'disabled', reason: 'notBuiltForUpdates' })
  })
  it('covers every update:* call the preload makes', async () => {
    const fs = await import('node:fs/promises')
    const preload = await fs.readFile(new URL('../../preload/index.ts', import.meta.url), 'utf8')
    const called = new Set([...preload.matchAll(/invoke\('(update:[A-Za-z]+)'/g)].map((m) => m[1]))
    called.delete('update:campaignState') // answered in every build
    expect([...called].sort()).toEqual([...UPDATE_IPC_CHANNELS].sort())
  })
})
