/** 한글 담당을 스택에 직접 적는다 — 스펙 §4.3, 그리고 themes.test.ts 가 이것을 검사한다. */
const HANGUL = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', sans-serif"
/** The UI face (DESIGN.md §9). Bundled as woff2 in styles/tokens.css; nothing is fetched at runtime. */
export const SANS = `'IBM Plex Sans', ${HANGUL}`
/** The app UI's code face. The terminal's mono chain (core/terminal/font.ts) is separate — that one the
 *  person picks in settings. */
export const DEFAULT_MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace"

/** A palette that exists. `system` is not one: it resolves to `night` or `day` (resolveThemeId). */
export type PaletteId = 'night' | 'dusk' | 'day'
/** What the person picks and what settings store. */
export type ThemeId = PaletteId | 'system'
export type Density = 'compact' | 'normal' | 'roomy'

/** The tokens of DESIGN.md §9, one field per row of its table. */
export interface ThemeColors {
  bg: string
  panel: string
  elevated: string
  hover: string
  termBg: string
  line: string
  text: string
  textDim: string
  textFaint: string
  accent: string
  accentInk: string
  accentSoft: string
  ok: string
  okSoft: string
  warn: string
  warnSoft: string
  danger: string
  dangerSoft: string
}

export interface Theme {
  id: PaletteId
  /** 설정에 그대로 보이는 이름. 고유명사라 번역하지 않는다. */
  name: string
  /** CSS color-scheme: native controls and scrollbars follow it. */
  scheme: 'dark' | 'light'
  colors: ThemeColors
}

export const THEMES: readonly Theme[] = [
  {
    id: 'night',
    name: 'Night',
    scheme: 'dark',
    colors: {
      bg: '#0d0e12', panel: '#15171d', elevated: '#232631', hover: '#1c1f28', termBg: '#090a0d',
      line: '#262a35', text: '#eef0f5', textDim: '#a3a8b8', textFaint: '#7d8396',
      accent: '#c4f25a', accentInk: '#121a00', accentSoft: '#252e10',
      ok: '#5ad19a', okSoft: '#10291e', warn: '#f2b84b', warnSoft: '#30240c',
      danger: '#ff6b6b', dangerSoft: '#351719'
    }
  },
  {
    id: 'dusk',
    name: 'Dusk',
    scheme: 'dark',
    colors: {
      bg: '#141219', panel: '#1b1922', elevated: '#2a2734', hover: '#221f2b', termBg: '#0f0d13',
      line: '#2e2a38', text: '#f0edf6', textDim: '#aba5b9', textFaint: '#868097',
      accent: '#b79cff', accentInk: '#1a0f33', accentSoft: '#2a2240',
      ok: '#5ad19a', okSoft: '#14291f', warn: '#f2b84b', warnSoft: '#30240c',
      danger: '#ff6b6b', dangerSoft: '#351719'
    }
  },
  {
    id: 'day',
    name: 'Day',
    scheme: 'light',
    colors: {
      bg: '#f7f7f2', panel: '#ffffff', elevated: '#ebebe3', hover: '#f0f0ea', termBg: '#ffffff',
      line: '#e0e0d6', text: '#16181d', textDim: '#535866', textFaint: '#6b7080',
      accent: '#3f6212', accentInk: '#ffffff', accentSoft: '#e7f0d6',
      // DESIGN.md §9 had #15803d: 4.26:1 on --ok-soft, under the chip floor of 4.5. Darkened to 4.61.
      ok: '#147a3a', okSoft: '#dcf2e3', warn: '#8a5a00', warnSoft: '#fbefd5',
      danger: '#c42b2b', dangerSoft: '#fbe3e3'
    }
  }
]

/** Every choice the settings offer, in their order. */
export const THEME_IDS: readonly ThemeId[] = ['night', 'dusk', 'day', 'system']

/** 설정 파일에 아무것도 없을 때의 테마 — 새로 설치한 사람이 처음 보는 모습이다.
 *
 *  AppSettingsStore 는 이 값과 같은 테마를 파일에 쓰지 않으므로(생략 규칙), 이 상수를 바꾸면 **옛
 *  기본값을 쓰던 기존 설치도 함께 옮겨간다** — 파일에 키가 없어 "고른 적 없음"과 "옛 기본값을 골랐음"이
 *  구분되지 않기 때문이다. */
export const DEFAULT_THEME_ID: ThemeId = 'night'

/** localStorage 와 설정 파일에서 온 값의 신뢰 경계 — isMdViewMode 와 같은 역할. */
export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v)
}

/** A stored value read on load (DESIGN.md §13). Upstream's seven palettes (umbra, vega, …) and anything
 *  unknown become `night`; a stored `light` becomes `day`. */
export function themeIdOf(v: unknown): ThemeId {
  if (isThemeId(v)) return v
  return v === 'light' ? 'day' : DEFAULT_THEME_ID
}

/** `system` follows the OS: light → day, dark → night. */
export function resolveThemeId(id: ThemeId, prefersDark: boolean): PaletteId {
  if (id !== 'system') return id
  return prefersDark ? 'night' : 'day'
}

/** The palette for an id. `system` answers night here — callers that can ask the OS use resolveThemeId. */
export function themeById(id: ThemeId): Theme {
  const palette = resolveThemeId(id, true)
  return THEMES.find((t) => t.id === palette) ?? THEMES[0]
}
