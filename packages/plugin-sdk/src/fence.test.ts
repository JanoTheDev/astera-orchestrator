// @astera-app/plugin-sdk is published on its own: at run time it imports nothing at all, and its one import is the
// types of @astera-app/client, which a plugin installs beside it. Anything else would ship a package that cannot load.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.dirname(fileURLToPath(import.meta.url))

describe('the plugin-sdk fence', () => {
  it('imports only its own files and the types of @astera-app/client', () => {
    const bad: string[] = []
    for (const f of readdirSync(SRC).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const code = readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      for (const m of code.matchAll(/^\s*(import|export)\b[^\n]*?\bfrom\s*['"]([^'"]+)['"]/gm)) {
        const typeOnly = /^\s*(import|export)\s+type\b/.test(m[0])
        const own = /^\.\/[\w.-]+\.js$/.test(m[2])
        if (!own && !(typeOnly && m[2] === '@astera-app/client')) bad.push(`${f}: ${m[0].trim()}`)
      }
      if (/\b(require|import)\s*\(/.test(code)) bad.push(`${f}: a dynamic import or require`)
    }
    expect(bad).toEqual([])
  })
})
