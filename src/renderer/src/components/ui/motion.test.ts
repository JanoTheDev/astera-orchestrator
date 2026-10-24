import { describe, it, expect } from 'vitest'
import { DUR, DUR_FAST, EASE, presetFor, type MotionPreset } from './motion'
import { readFileSync } from 'node:fs'

const PRESETS: MotionPreset[] = ['fade', 'rise', 'scale', 'height']

describe('motion presets', () => {
  it('keep transforms and height when motion is allowed', () => {
    expect(presetFor('rise', false)).toEqual({ opacity: 0, y: 4 })
    expect(presetFor('scale', false)).toEqual({ opacity: 0, scale: 0.96 })
    expect(presetFor('height', false)).toEqual({ opacity: 0, height: 0 })
  })

  it('reduced motion leaves opacity only, for every preset', () => {
    for (const p of PRESETS) expect(presetFor(p, true)).toEqual({ opacity: 0 })
  })

  it('mirror the --dur, --dur-fast and --ease-out tokens', () => {
    const tokens = readFileSync('src/renderer/src/styles/tokens.css', 'utf8')
    expect(tokens).toContain(`--motion: ${DUR * 1000}ms;`)
    expect(tokens).toContain(`--dur-fast: ${DUR_FAST * 1000}ms;`)
    expect(tokens).toContain(`--ease-out: cubic-bezier(${EASE.join(', ')});`)
  })
})
