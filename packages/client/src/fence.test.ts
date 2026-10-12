// @astera-app/client is published on its own (SDK spec, repository strategy). It may import only its own files and
// Node built-ins: a path into the app, Electron, a native module or an npm dependency would ship a package that
// cannot load. Relative imports carry `.js`, which Node's ESM loader needs.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.dirname(fileURLToPath(import.meta.url))

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [path.join(dir, e.name)] : []
  )

const specifiers = (text: string): string[] =>
  [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('the package fence', () => {
  it('finds the sources', () => {
    expect(sources(SRC).length).toBeGreaterThan(0)
  })

  it('imports only its own files, with .js, and node: built-ins', () => {
    const bad: string[] = []
    for (const file of sources(SRC)) {
      for (const s of specifiers(readFileSync(file, 'utf8'))) {
        if (s.startsWith('node:')) continue
        const inside = (s.startsWith('./') || s.startsWith('../')) && path.resolve(path.dirname(file), s).startsWith(SRC + path.sep)
        if (!inside || !s.endsWith('.js')) bad.push(`${path.relative(SRC, file)}: ${s}`)
      }
    }
    expect(bad).toEqual([])
  })
})
