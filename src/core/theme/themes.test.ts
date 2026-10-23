import { describe, it, expect } from 'vitest'
import {
  THEMES,
  THEME_IDS,
  DEFAULT_THEME_ID,
  SANS,
  isThemeId,
  themeById,
  themeIdOf,
  resolveThemeId
} from './themes'

describe('THEMES', () => {
  it('night, dusk and day, and the choices add system', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['night', 'dusk', 'day'])
    expect(THEME_IDS).toEqual(['night', 'dusk', 'day', 'system'])
  })

  it('기본값은 night — 새로 설치한 사람이 처음 보는 모습이다', () => {
    expect(DEFAULT_THEME_ID).toBe('night')
    expect(themeById('night').name).toBe('Night')
  })

  // 하나라도 빠지면 그 테마에서 CSS 변수가 미정의가 되어 상속된 엉뚱한 값이 나온다.
  it('every palette has exactly the same colour keys', () => {
    const keys = THEMES.map((t) => Object.keys(t.colors).sort().join(','))
    expect(new Set(keys).size).toBe(1)
  })

  it('every colour is a 6-digit hex — tokens.css and the contrast test read them as such', () => {
    for (const t of THEMES) for (const [k, v] of Object.entries(t.colors)) expect(v, `${t.id}.${k}`).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('day is the only light palette', () => {
    expect(THEMES.filter((t) => t.scheme === 'light').map((t) => t.id)).toEqual(['day'])
  })

  it('--sans 스택에 한글 담당이 명시돼 있다', () => {
    expect(SANS).toMatch(/^system-ui, /)
    expect(SANS).toContain('Malgun Gothic')
    expect(SANS).toContain('Apple SD Gothic Neo')
    expect(SANS).toContain('Noto Sans CJK KR')
  })
})

describe('isThemeId', () => {
  it('아는 id 는 통과', () => {
    for (const id of THEME_IDS) expect(isThemeId(id)).toBe(true)
  })

  it('모르는 값·타입이 다른 값은 거부 — localStorage 와 디스크는 사람이 고칠 수 있다', () => {
    for (const v of ['darcula', 'umbra', 'light', '', null, undefined, 3, {}, []]) expect(isThemeId(v)).toBe(false)
  })
})

describe('themeIdOf (DESIGN.md §13: saved state keeps working)', () => {
  it.each(['umbra', 'vega', 'aurora', 'orion', 'antares', 'quasar', 'sirius'])('old id %s → night', (old) => {
    expect(themeIdOf(old)).toBe('night')
  })

  it('light → day', () => {
    expect(themeIdOf('light')).toBe('day')
  })

  it('current ids pass through; junk falls back to night', () => {
    for (const id of THEME_IDS) expect(themeIdOf(id)).toBe(id)
    for (const v of ['', null, undefined, 3, {}]) expect(themeIdOf(v)).toBe('night')
  })
})

describe('resolveThemeId', () => {
  it('system follows the OS: dark → night, light → day', () => {
    expect(resolveThemeId('system', true)).toBe('night')
    expect(resolveThemeId('system', false)).toBe('day')
  })

  it('a palette id is itself whatever the OS says', () => {
    expect(resolveThemeId('dusk', false)).toBe('dusk')
    expect(resolveThemeId('day', true)).toBe('day')
  })
})

describe('themeById', () => {
  it('아는 id 는 그 테마', () => {
    expect(themeById('dusk').id).toBe('dusk')
  })

  it('system without the OS answers night', () => {
    expect(themeById('system').id).toBe('night')
  })
})
