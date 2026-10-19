import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = join(__dirname, '../../../..')
const app = readFileSync(join(__dirname, 'mark.svg'), 'utf8')
const source = readFileSync(join(repo, 'assets/mark.svg'), 'utf8')

describe('the mark', () => {
  it('the app copy is the same as assets/mark.svg', () => {
    expect(app).toBe(source)
  })

  // An XML comment may not contain "--": the title bar showed a broken image when one named --accent.
  it('parses as XML: no "--" inside a comment', () => {
    for (const m of app.matchAll(/<!--([\s\S]*?)-->/g)) expect(m[1]).not.toContain('--')
  })
})
