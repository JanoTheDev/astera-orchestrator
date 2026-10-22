import { describe, it, expect } from 'vitest'
import { themeCssVars, xtermThemeOf, DENSITY } from './apply'
import { themeById, THEMES, DEFAULT_MONO } from './themes'

describe('themeCssVars', () => {
  it('표면·텍스트 토큰을 CSS 변수 이름으로 낸다', () => {
    const v = themeCssVars(themeById('night'))
    expect(v['--bg']).toBe('#0e0f12')
    expect(v['--text-dim']).toBe('#a2a6b0')
    expect(v['--hover']).toBe('#1a1b20')
    expect(v['--term-bg']).toBe('#0b0c0e')
  })

  it('--ring 은 액센트의 60% 알파다', () => {
    expect(themeCssVars(themeById('night'))['--ring']).toBe('rgba(139, 147, 255, 0.6)')
  })

  it('the stylesheet\'s older names derive from the §9 tokens', () => {
    const v = themeCssVars(themeById('day'))
    expect(v['--rail']).toBe(v['--bg'])
    expect(v['--surface-hover']).toBe(v['--hover'])
    expect(v['--line-soft']).toBe(v['--line'])
    expect(v['--ok-bg']).toBe(v['--ok-soft'])
    expect(v['--warn-bg']).toBe(v['--warn-soft'])
    expect(v['--danger-bg']).toBe(v['--danger-soft'])
    expect(v['--btn-bg']).toBe(v['--accent'])
    expect(v['--btn-ink']).toBe(v['--accent-ink'])
  })

  it('every theme uses the bundled faces', () => {
    for (const t of THEMES) {
      expect(themeCssVars(t)['--sans']).toContain('IBM Plex Sans')
      expect(themeCssVars(t)['--mono']).toBe(DEFAULT_MONO)
      expect(themeCssVars(t)['--mono']).toContain('JetBrains Mono')
    }
  })

  it('모든 테마가 정확히 같은 변수 이름 집합을 낸다', () => {
    const sets = THEMES.map((t) => Object.keys(themeCssVars(t)).sort().join(','))
    expect(new Set(sets).size).toBe(1)
  })

  it('값이 빈 문자열인 변수가 없다 — setProperty 로 심으면 조용히 사라진다', () => {
    for (const t of THEMES) {
      for (const [name, value] of Object.entries(themeCssVars(t))) {
        expect(value, name).not.toBe('')
      }
    }
  })

  it('길이 토큰은 단위를 갖고, 그림자는 목록에 넣을 수 있는 값이다', () => {
    // 단위 없는 0 은 calc() 안에서 <length> 가 아니라 <number> 라 선언 전체가 무효가 되고,
    // 'none' 은 box-shadow 목록의 원소로 올 수 없어 같은 일이 벌어진다. 둘 다 실제로 겪은 결함이다.
    for (const t of THEMES) {
      const v = themeCssVars(t)
      for (const k of ['--radius', '--radius-lg', '--radius-sm', '--marker-w']) expect(v[k], k).toMatch(/^\d+px$/)
      for (const k of ['--shadow-sm', '--shadow-lg']) expect(v[k], k).not.toBe('none')
    }
  })
})

describe('xtermThemeOf', () => {
  it('배경·전경·커서 셋만 낸다 — ANSI 16색은 건드리지 않는다', () => {
    expect(xtermThemeOf(themeById('night'))).toEqual({
      background: '#0b0c0e',
      foreground: '#eceef2',
      cursor: '#8b93ff'
    })
  })
})

describe('DENSITY', () => {
  it('세 등급이 있다', () => {
    expect(Object.keys(DENSITY).sort()).toEqual(['compact', 'normal', 'roomy'])
  })
})
