/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { themeCssVars } from '../../../core/theme/apply'
import { themeById } from '../../../core/theme/themes'

// The :root block is the fallback before the theme provider runs, so it must be night exactly — a drift here
// shows as a flash of another palette on every launch.
const css = readFileSync(path.join(__dirname, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const rootVars = (): Map<string, string> => {
  const body = /(^|\n):root\s*\{([^}]*)\}/.exec(css)?.[2] ?? ''
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim())
  return out
}

describe('tokens.css :root is night', () => {
  const night = themeCssVars(themeById('night'))
  const root = rootVars()

  it('declares every variable the theme provider writes', () => {
    expect(Object.keys(night).filter((k) => !root.has(k))).toEqual([])
  })

  it('with the value themeCssVars gives night', () => {
    for (const [k, v] of Object.entries(night)) expect(root.get(k), k).toBe(v)
  })

  it('and declares a variable once', () => {
    const names = [...(/(^|\n):root\s*\{([^}]*)\}/.exec(css)?.[2] ?? '').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
    expect(names.length).toBe(new Set(names).size)
  })

  it('turns motion off under reduced motion', () => {
    expect(root.get('--motion')).toBe('150ms')
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{\s*--motion:\s*0ms/)
  })
})
