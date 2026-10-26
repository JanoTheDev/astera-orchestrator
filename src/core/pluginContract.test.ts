// The app reads the plugin SDK through one module, the way it reads the client SDK (publicContract.test.ts).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

describe('one door into the plugin SDK', () => {
  it('no app source but pluginContract.ts imports packages/plugin-sdk', () => {
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx|mts|cts)$/.test(e.name) && !/\.test\.(ts|tsx|mts|cts)$/.test(e.name) ? [path.join(dir, e.name)] : []
      )
    const doors = walk(srcRoot)
      // Import and export specifiers only: a comment that names the package is not a door
      .filter((f) => /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"][^'"\n]*packages\/plugin-sdk[^'"\n]*['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(srcRoot, f).split(path.sep).join('/'))
    expect(doors).toEqual(['core/pluginContract.ts'])
  })

  it('the package index loads in the renderer: no node: import, only a type import', () => {
    const index = readFileSync(new URL('../../packages/plugin-sdk/src/index.ts', import.meta.url), 'utf8')
    expect(index).not.toMatch(/from\s*['"]node:/)
    expect(index.match(/^import .* from /gm)?.every((l) => l.startsWith('import type '))).toBe(true)
  })
})
