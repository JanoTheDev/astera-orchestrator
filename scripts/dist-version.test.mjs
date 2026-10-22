// The build version electron-builder packages under (docs/releasing.md, "Build versions").
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVersion, chainSteps, utcStamp, withVersion } from './dist-version.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const now = new Date(Date.UTC(2026, 9, 22, 7, 5)) // 2026-10-22 07:05 UTC

describe('buildVersion', () => {
  it('appends the UTC build time and the short sha to the package version', () => {
    expect(buildVersion({ version: '1.4.14', now, sha: 'ab0021b', tagAtHead: false })).toBe('1.4.14-build.202610220705.ab0021b')
  })

  it('keeps the plain version when HEAD is the release tag, so electron-updater orders it as the release', () => {
    expect(buildVersion({ version: '1.4.14', now, sha: 'ab0021b', tagAtHead: true })).toBe('1.4.14')
  })

  it('drops the sha outside a git checkout', () => {
    expect(buildVersion({ version: '1.4.14', now, sha: null, tagAtHead: false })).toBe('1.4.14-build.202610220705')
  })

  it('stamps in UTC with zero padding', () => {
    expect(utcStamp(new Date(Date.UTC(2027, 0, 2, 3, 4)))).toBe('202701020304')
    expect(utcStamp(new Date(Date.UTC(2026, 11, 31, 23, 59)))).toBe('202612312359')
  })

  it('gives electron-builder the version and leaves other steps alone', () => {
    expect(withVersion(['electron-builder', '--linux'], '1.0.0-build.1')).toEqual(['electron-builder', '-c.extraMetadata.version=1.0.0-build.1', '--linux'])
    expect(withVersion(['npm', 'run', 'host-runtime'], '1.0.0-build.1')).toEqual(['npm', 'run', 'host-runtime'])
  })

  it('splits steps on +, and refuses an empty step', () => {
    expect(chainSteps(['electron-vite', 'build', '+', 'electron-builder', '--linux'])).toEqual([['electron-vite', 'build'], ['electron-builder', '--linux']])
    expect(() => chainSteps(['electron-vite', '+'])).toThrow('usage')
  })

  it('runs every step with ASTERA_BUILD_VERSION set to the same version it prints', () => {
    const r = spawnSync(process.execPath, [path.join(here, 'dist-version.mjs'), 'node', '-p', 'process.env.ASTERA_BUILD_VERSION', '+', 'node', '-p', 'process.env.ASTERA_BUILD_VERSION'], { encoding: 'utf8' })
    const printed = spawnSync(process.execPath, [path.join(here, 'dist-version.mjs')], { encoding: 'utf8' }).stdout.trim()
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe(`${printed}\n${printed}\n`)
  })

  it('stops the chain at the first failing step', () => {
    const r = spawnSync(process.execPath, [path.join(here, 'dist-version.mjs'), 'node', '-e', '0', '+', 'node', '--check', 'no-such-file.mjs', '+', 'node', '-p', 'process.env.ASTERA_BUILD_VERSION'], { encoding: 'utf8' })
    expect(r.status).not.toBe(0)
    expect(r.stdout).toBe('')
  })

  it('prints a version for this checkout, in either form', () => {
    const r = spawnSync(process.execPath, [path.join(here, 'dist-version.mjs')], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    const { version } = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
    expect(r.stdout.trim()).toMatch(new RegExp(`^${version.replaceAll('.', '\\.')}(-build\\.\\d{12}(\\.[0-9a-f]{7})?)?$`))
  })
})
