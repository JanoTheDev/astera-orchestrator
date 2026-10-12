// The app reads the public contract from the SDK package (packages/client), one copy for the CLI, MCP and the SDK.
import { describe, it, expect } from 'vitest'
import * as pkg from '../../packages/client/src/index.js'
import * as cliOutput from './orchestration/cliOutput'

describe('the app uses the package contract', () => {
  it('the CLI error codes and their mapping are the package ones', () => {
    expect(cliOutput.CLI_ERROR_CODES).toBe(pkg.ERROR_CODES)
    expect(cliOutput.REMOTE_ERROR_CODES).toBe(pkg.REMOTE_ERROR_CODES)
    expect(cliOutput.codeForStatus).toBe(pkg.codeForStatus)
    expect(cliOutput.exitCodeFor).toBe(pkg.exitCodeFor)
    expect(cliOutput.remoteCodeOf).toBe(pkg.remoteCodeOf)
  })
})

// Final review of SDK 1a: the app reaches the package through this one module, so the boundary has one door. Tests
// may import the package directly to compare against it.
describe('one door into the package', () => {
  it('no app source but publicContract.ts imports packages/client', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx|mts|cts)$/.test(e.name) && !/\.test\.(ts|tsx|mts|cts)$/.test(e.name) ? [path.join(dir, e.name)] : []
      )
    const doors = walk(srcRoot)
      .filter((f) => /['"][^'"\n]*packages\/client[^'"\n]*['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(srcRoot, f).split(path.sep).join('/'))
    expect(doors).toEqual(['core/publicContract.ts'])
  })
})
