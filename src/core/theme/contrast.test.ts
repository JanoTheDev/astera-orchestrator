import { describe, it, expect } from 'vitest'
import { relativeLuminance, contrastRatio } from './contrast'
import { THEMES, type ThemeColors } from './themes'

describe('contrastRatio', () => {
  it('흰색과 검정은 21:1', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2)
  })

  it('같은 색은 1:1', () => {
    expect(contrastRatio('#17171a', '#17171a')).toBeCloseTo(1, 5)
  })

  it('순서가 바뀌어도 같은 값', () => {
    expect(contrastRatio('#d0d0d6', '#17171a')).toBeCloseTo(contrastRatio('#17171a', '#d0d0d6'), 5)
  })
})

describe('relativeLuminance', () => {
  it('검정 0, 흰색 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
})

/** DESIGN.md §9 "Contrast", for every theme: dim on --elevated ≥ 4.5, faint ≥ 3, ink on accent ≥ 4.5, and
 *  chip text on its soft background ≥ 4.5. --text is AAA on the surface it is read on (--bg) and AA on
 *  the surfaces it passes over. */
const CHECKS: { label: string; fg: keyof ThemeColors; bg: keyof ThemeColors; min: number }[] = [
  { label: 'text on bg', fg: 'text', bg: 'bg', min: 7 },
  { label: 'text on panel', fg: 'text', bg: 'panel', min: 4.5 },
  { label: 'text on elevated', fg: 'text', bg: 'elevated', min: 4.5 },
  { label: 'text on term-bg', fg: 'text', bg: 'termBg', min: 7 },
  { label: 'text-dim on elevated', fg: 'textDim', bg: 'elevated', min: 4.5 },
  { label: 'text-dim on bg', fg: 'textDim', bg: 'bg', min: 4.5 },
  { label: 'text-faint on elevated', fg: 'textFaint', bg: 'elevated', min: 3 },
  { label: 'accent on bg', fg: 'accent', bg: 'bg', min: 3 },
  { label: 'accent-ink on accent', fg: 'accentInk', bg: 'accent', min: 4.5 },
  { label: 'accent on accent-soft (chip)', fg: 'accent', bg: 'accentSoft', min: 4.5 },
  { label: 'ok on ok-soft (chip)', fg: 'ok', bg: 'okSoft', min: 4.5 },
  { label: 'warn on warn-soft (chip)', fg: 'warn', bg: 'warnSoft', min: 4.5 },
  { label: 'danger on danger-soft (chip)', fg: 'danger', bg: 'dangerSoft', min: 4.5 },
  { label: 'info on info-soft (chip)', fg: 'info', bg: 'infoSoft', min: 4.5 },
  { label: 'ok on panel', fg: 'ok', bg: 'panel', min: 3 },
  { label: 'warn on panel', fg: 'warn', bg: 'panel', min: 3 },
  { label: 'danger on panel', fg: 'danger', bg: 'panel', min: 3 }
]

describe.each(THEMES.map((t) => [t.id, t] as const))('%s contrast', (_id, theme) => {
  it.each(CHECKS)('$label ≥ $min', ({ fg, bg, min }) => {
    expect(contrastRatio(theme.colors[fg], theme.colors[bg])).toBeGreaterThanOrEqual(min)
  })
})

/** Colours outside the themes (DESIGN.md §9 "Other tokens": file-icon, git, PR, brand and role colours).
 *  They are not redefined per theme, so they are checked on the brightest dark surface (dusk's
 *  --elevated). On day they are not held to 3:1 — they sit beside a label that carries the meaning. */
const BRIGHTEST_DARK_SURFACE = '#2a2734'

const SHARED: Record<string, string> = {
  '--fi-blue': '#5b9fe0', '--fi-cyan': '#4fb6c4', '--fi-green': '#7fbf6a', '--fi-yellow': '#d7b45a',
  '--fi-orange': '#d68b4f', '--fi-red': '#d3706b', '--fi-purple': '#a98ede', '--fi-pink': '#d47fae',
  '--fi-gray': '#8a8a94',
  '--git-new': '#79c98f', '--git-modified': '#d7b45a', '--git-deleted': '#d3706b',
  '--git-conflict': '#d68b4f',
  '--brand-claude': '#d97757', '--role-user': '#4f9cf9', '--role-assistant': '#f97316'
}

describe('colours outside the themes', () => {
  it('are dark-only palettes: every dark surface is at most as bright as the one they are checked on', () => {
    for (const t of THEMES.filter((th) => th.scheme === 'dark'))
      for (const k of ['bg', 'panel', 'elevated', 'hover'] as const)
        expect(relativeLuminance(t.colors[k])).toBeLessThanOrEqual(relativeLuminance(BRIGHTEST_DARK_SURFACE) + 1e-9)
  })

  it.each(Object.entries(SHARED))('%s 는 가장 밝은 어두운 표면에서 3:1 이상', (_name, color) => {
    expect(contrastRatio(color, BRIGHTEST_DARK_SURFACE)).toBeGreaterThanOrEqual(3)
  })
})
