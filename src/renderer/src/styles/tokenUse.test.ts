/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Type size, radius, elevation and the focus ring come from styles/tokens.css (docs/dev/DESIGN-W11.md §3-§6).
// A raw value in a component stylesheet is one the scale cannot move. Colour has its own test
// (noColourLiterals.test.ts).
const ROOT = path.join(__dirname, '..')

/** File → why it is skipped. tokens.css defines the values; tailwind.css is vendored. */
const SKIP: Record<string, string> = {
  'styles/tokens.css': 'defines the tokens',
  'tailwind.css': 'vendored utility layer'
}
/** The component-library Task is rewriting these; drop the entries when it lands. */
const PENDING: Record<string, string> = {
  'styles/primitives.css': 'owned by the component-library Task (in flight)',
  'styles/modal.css': 'owned by the component-library Task (in flight)',
  'styles/select.css': 'owned by the component-library Task (in flight)'
}

const rel = (f: string): string => path.relative(ROOT, f).split(path.sep).join('/')

const cssFiles = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) cssFiles(p, out)
    else if (e.name.endsWith('.css') && !(rel(p) in SKIP) && !(rel(p) in PENDING)) out.push(p)
  }
  return out
}

const stripped = (f: string): string =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, 'url()')

/** Declarations as [line, property, value]. */
const decls = (f: string): [number, string, string][] => {
  const out: [number, string, string][] = []
  stripped(f).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) out.push([i + 1, m[1], m[2].trim()])
  })
  return out
}

/** Rules as [selector, body], skipping at-rule heads. */
const rules = (f: string): [string, string][] =>
  [...stripped(f).matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])

const files = cssFiles(ROOT)
const hits = (test: (prop: string, value: string) => boolean): string[] =>
  files.flatMap((f) => decls(f).filter(([, p, v]) => test(p, v)).map(([n, p, v]) => `${rel(f)}:${n}: ${p}: ${v}`))

describe('component CSS reads the design tokens', () => {
  it('finds the stylesheets — an empty walk would make the checks pass on nothing', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('font-size is a --fs-* token, not px', () => {
    expect(hits((p, v) => p === 'font-size' && /\d(\.\d+)?px/.test(v))).toEqual([])
  })

  it('the font shorthand takes its size from a --fs-* token', () => {
    // the size is the number that is not a weight and not after the `/` line-height
    expect(hits((p, v) => p === 'font' && /(^|\s)\d+(\.\d+)?px(?![^\s]*\/)/.test(v))).toEqual([])
  })

  it('border-radius is a --radius-* token (0 and 50% are allowed)', () => {
    expect(
      hits((p, v) => p.startsWith('border') && p.endsWith('radius') && /\d(\.\d+)?px/.test(v) && !/^0(px)?$/.test(v))
    ).toEqual([])
  })

  it('box-shadow elevation is a --shadow-* token; a 0-blur ring or edge and an inset glow are allowed', () => {
    // `0 0 0 2px x` and `inset 2px 0 0 x` have no blur: they draw a border or a marker. An inset glow (the
    // agent frame) lights an edge from inside; only an outer blurred shadow is elevation.
    const blurred = (v: string): boolean =>
      v.split(/,(?![^(]*\))/).some((layer) => {
        if (/^\s*inset\b/.test(layer)) return false
        const lens = layer.replace(/\bvar\([^)]*\)|color-mix\((?:[^()]|\([^)]*\))*\)|inset/g, ' ').match(/-?[\d.]+(?:px)?/g) ?? []
        return lens.length >= 3 && parseFloat(lens[2]) !== 0
      })
    expect(hits((p, v) => p === 'box-shadow' && blurred(v))).toEqual([])
  })

  it('the focus ring is --focus-ring; --ring is gone', () => {
    expect(hits((_p, v) => /var\(--ring\)/.test(v))).toEqual([])
  })

  it('outline is only turned off in a rule that draws a ring (box-shadow) instead', () => {
    const bad: string[] = []
    for (const f of files)
      for (const [sel, body] of rules(f))
        if (/(^|[;\s])outline\s*:\s*(none|0)\s*(;|$|!)/.test(body) && !/box-shadow\s*:/.test(body))
          bad.push(`${rel(f)}: ${sel.replace(/\s+/g, ' ')}`)
    expect(bad).toEqual([])
  })
})
