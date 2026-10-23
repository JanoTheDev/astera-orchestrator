/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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

/** DESIGN-W13.md §11 "Contrast", for every theme: dim on --elevated ≥ 4.5, faint ≥ 3, ink on accent ≥ 4.5, and
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
  // An accent chip or selected row is --text on --accent-soft; the accent itself is the 2px marker on it.
  { label: 'text on accent-soft (chip, selected row)', fg: 'text', bg: 'accentSoft', min: 4.5 },
  { label: 'accent marker on accent-soft', fg: 'accent', bg: 'accentSoft', min: 3 },
  { label: 'link on bg', fg: 'link', bg: 'bg', min: 4.5 },
  { label: 'link on panel', fg: 'link', bg: 'panel', min: 4.5 },
  { label: 'ok on ok-soft (chip)', fg: 'ok', bg: 'okSoft', min: 4.5 },
  { label: 'warn on warn-soft (chip)', fg: 'warn', bg: 'warnSoft', min: 4.5 },
  { label: 'danger on danger-soft (chip)', fg: 'danger', bg: 'dangerSoft', min: 4.5 },
  { label: 'info on info-soft (chip)', fg: 'info', bg: 'infoSoft', min: 4.5 },
  { label: 'ok on panel', fg: 'ok', bg: 'panel', min: 3 },
  { label: 'warn on panel', fg: 'warn', bg: 'panel', min: 3 },
  { label: 'danger on panel', fg: 'danger', bg: 'panel', min: 3 },
  // the workbench (DESIGN-W13.md §11): text on every surface it is read on, icons and marks at 3:1
  { label: 'activity icon on activitybar', fg: 'activitybarFg', bg: 'activitybarBg', min: 4.5 },
  { label: 'dim activity icon on activitybar', fg: 'activitybarFgDim', bg: 'activitybarBg', min: 3 },
  { label: 'text on sidebar', fg: 'text', bg: 'sidebarBg', min: 4.5 },
  { label: 'text-dim on sidebar', fg: 'textDim', bg: 'sidebarBg', min: 4.5 },
  { label: 'text on editor', fg: 'text', bg: 'editorBg', min: 7 },
  { label: 'text on active tab', fg: 'text', bg: 'tabActiveBg', min: 4.5 },
  { label: 'text-dim on inactive tab', fg: 'textDim', bg: 'tabInactiveBg', min: 4.5 },
  { label: 'active tab border on tab bar', fg: 'tabBorderActive', bg: 'tabBarBg', min: 3 },
  { label: 'text on panel ground', fg: 'text', bg: 'panelBg', min: 4.5 },
  { label: 'statusbar text', fg: 'statusbarFg', bg: 'statusbarBg', min: 4.5 },
  { label: 'focus border on editor', fg: 'focusBorder', bg: 'editorBg', min: 3 },
  { label: 'focus border on sidebar', fg: 'focusBorder', bg: 'sidebarBg', min: 3 },
  { label: 'text on list hover', fg: 'text', bg: 'listHover', min: 4.5 },
  { label: 'text on list active', fg: 'text', bg: 'listActive', min: 4.5 },
  { label: 'text on inactive selection', fg: 'text', bg: 'listInactiveSelection', min: 4.5 },
  { label: 'badge text', fg: 'badgeFg', bg: 'badgeBg', min: 4.5 }
]

describe.each(THEMES.map((t) => [t.id, t] as const))('%s contrast', (_id, theme) => {
  it.each(CHECKS)('$label ≥ $min', ({ fg, bg, min }) => {
    expect(contrastRatio(theme.colors[fg], theme.colors[bg])).toBeGreaterThanOrEqual(min)
  })
})

/** Colours outside the themes (DESIGN.md §9 "Other tokens": file-icon, git, PR, brand, role and syntax colours,
 *  --run). The themes never write them; tokens.css holds the Night/Dusk values in :root and Day's repaint in
 *  :root[data-theme='day']. Each is measured against every surface it can sit on, in every theme, so a Day
 *  override cannot drift under 3:1 unseen. They are marks beside a label or glyph, hence 3:1 (WCAG 1.4.11). */
const css = readFileSync(path.join(__dirname, '../../renderer/src/styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const varsOf = (block: RegExp): Record<string, string> => {
  const body = block.exec(css)?.[1] ?? ''
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}
const BASE = varsOf(/(?:^|\n):root\s*\{([^}]*)\}/)
const DAY = varsOf(/:root\[data-theme='day'\]\s*\{([^}]*--fi-blue[^}]*)\}/)
const fixedFor = (id: string): Record<string, string> => ({ ...BASE, ...(id === 'day' ? DAY : {}) })

/** Fixed colours that carry meaning, by prefix. */
const MARKS = /^--(fi|git|syn|pr|brand|role)-/
/** Deliberately below 3:1, with the reason. --fi-mute dims dependency and build folders to suppress noise;
 *  --syn-invalid-* is a pair measured as text-on-fill below. */
const EXEMPT = new Set(['--fi-mute', '--syn-invalid-ink', '--syn-invalid-bg'])

describe.each(THEMES.map((t) => [t.id, t] as const))('%s: colours outside the themes', (id, theme) => {
  const fixed = fixedFor(id)
  const marks = Object.entries(fixed).filter(([k, v]) => MARKS.test(k) && !EXEMPT.has(k) && /^#[0-9a-f]{3,8}$/i.test(v))
  // the surfaces a mark sits on: the page, a panel or card, a menu or chip, the terminal / code ground
  const surfaces = (['bg', 'panel', 'elevated', 'termBg'] as const).map((k) => [k, theme.colors[k]] as const)

  it('finds the marks — an empty list would pass on nothing', () => {
    expect(marks.length).toBeGreaterThan(25)
  })

  it.each(marks.flatMap(([name, color]) => surfaces.map(([s, bg]) => [name, s, color, bg] as const)))(
    '%s on %s ≥ 3',
    (_name, _surface, color, bg) => {
      expect(contrastRatio(color, bg)).toBeGreaterThanOrEqual(3)
    }
  )

  it.each(['--run', '--info'] as const)('%s on panel ≥ 3', (name) => {
    expect(contrastRatio(fixed[name], theme.colors.panel)).toBeGreaterThanOrEqual(3)
  })

  // text on a fixed fill
  it.each([
    ['--ink-white', '--confirm', 4.5],
    ['--ink-white', '--confirm-hover', 4.5],
    ['--ink-white', '--agent-accent', 4.5],
    ['--syn-invalid-ink', '--syn-invalid-bg', 3]
  ] as const)('%s on %s ≥ %s', (fg, bg, min) => {
    expect(contrastRatio(fixed[fg], fixed[bg])).toBeGreaterThanOrEqual(min)
  })
})
