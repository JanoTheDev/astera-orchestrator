// @astera-app/client is to be published on its own (SDK spec, repository strategy). It may import only its own files
// and Node built-ins: a path into the app, Electron, a native module or an npm dependency would ship a package that
// cannot load. Relative imports carry `.js`, which Node's ESM loader needs. The build test checks the same on the
// compiled CommonJS, where tsc has turned every import into a `require` (scripts/build-packages.test.mjs).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.dirname(fileURLToPath(import.meta.url))

/** Built-ins the package must not use: `node:sqlite` is not in every Node the package supports, and the app's
 *  journal is the only thing in the repo that needs it. */
const BLOCKED_BUILTINS = new Set(['node:sqlite'])

const SOURCE = /\.(ts|mts|cts|tsx)$/
const TEST = /\.test\.(ts|mts|cts|tsx)$/

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : SOURCE.test(e.name) && !TEST.test(e.name) ? [path.join(dir, e.name)] : []
  )

/** The text with its comments blanked, strings and template literals kept: an `import` in a JSDoc example is not an
 *  import. */
export function withoutComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
      out += ' '
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else {
      out += c
      i++
    }
  }
  return out
}

/** What a source may not do, one line each. */
export function fenceViolations(text: string, file: string, src: string): string[] {
  const bad: string[] = []
  if (/^\s*\/\/\/\s*<reference\b/m.test(text)) bad.push('a triple-slash reference')
  const code = withoutComments(text)
  if (/\bcreateRequire\b/.test(code)) bad.push('createRequire')
  // A dynamic import or require whose argument is not a plain string cannot be checked, so it is not allowed
  for (const m of code.matchAll(/\b(import|require)\s*\(\s*(?!['"])/g)) bad.push(`${m[1]}( with a computed argument`)
  const specifiers = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])
  for (const s of specifiers) {
    if (s.startsWith('node:')) {
      if (BLOCKED_BUILTINS.has(s)) bad.push(s)
      continue
    }
    const inside = (s.startsWith('./') || s.startsWith('../')) && path.resolve(path.dirname(file), s).startsWith(src + path.sep)
    if (!inside || !s.endsWith('.js')) bad.push(s)
  }
  return bad
}

describe('the package fence', () => {
  it('finds the sources', () => {
    expect(sources(SRC).length).toBeGreaterThan(0)
  })

  it('imports only its own files, with .js, and node: built-ins', () => {
    const bad = sources(SRC).flatMap((file) =>
      fenceViolations(readFileSync(file, 'utf8'), file, SRC).map((v) => `${path.relative(SRC, file)}: ${v}`)
    )
    expect(bad).toEqual([])
  })

  // Final review of SDK 1a, Important 1: the first fence read `from` and `import` only.
  it('catches require, createRequire, computed imports, references and blocked built-ins', () => {
    const file = path.join(SRC, 'x.ts')
    const scan = (text: string): string[] => fenceViolations(text, file, SRC)
    expect(scan("export const e = (): unknown => require('electron')")).toEqual(['electron'])
    expect(scan("const r = createRequire(import.meta.url)\nr('../package.json')")).toEqual(['createRequire'])
    expect(scan('const m = await import(name)')).toEqual(['import( with a computed argument'])
    expect(scan('const m = require(`./${n}.js`)')).toEqual(['require( with a computed argument'])
    expect(scan('/// <reference types="electron" />\nexport {}')).toEqual(['a triple-slash reference'])
    expect(scan("import { DatabaseSync } from 'node:sqlite'")).toEqual(['node:sqlite'])
    expect(scan("export * from './errors'")).toEqual(['./errors'])
    expect(scan("import x from '../../../src/core/types.js'")).toEqual(['../../../src/core/types.js'])
  })

  it('lets its own files, node: built-ins and comments through', () => {
    const file = path.join(SRC, 'x.ts')
    const scan = (text: string): string[] => fenceViolations(text, file, SRC)
    expect(scan("export * from './errors.js'\nimport net from 'node:net'\nconst m = await import('./shape.js')")).toEqual([])
    expect(scan("/** @example\n * import { createAsteraClient } from '@astera-app/client'\n */\nexport {}")).toEqual([])
    expect(scan("// require('electron')\nexport const url = 'https://github.com/parsingk/Astera'")).toEqual([])
  })
})
