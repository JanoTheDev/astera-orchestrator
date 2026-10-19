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

/** The tokens of DESIGN-W11.md §2 (palette), one field per row of its table. */
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
  /** Not in DESIGN.md §9's table; added for the info Chip (§10) so it follows light and dark. */
  info: string
  infoSoft: string
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
      bg: '#0e0f12', panel: '#15161a', elevated: '#202227', hover: '#1a1b20', termBg: '#0b0c0e',
      line: '#26282e', text: '#eceef2', textDim: '#a2a6b0', textFaint: '#7c818c',
      accent: '#8b93ff', accentInk: '#0c0e33', accentSoft: '#1d2042',
      ok: '#4cc38a', okSoft: '#0f2a1e', warn: '#f0b35a', warnSoft: '#2e2310',
      danger: '#f2696b', dangerSoft: '#341819',
      info: '#6eb6ff', infoSoft: '#0f2238'
    }
  },
  {
    id: 'dusk',
    name: 'Dusk',
    scheme: 'dark',
    colors: {
      bg: '#13141b', panel: '#1a1b24', elevated: '#252633', hover: '#20212b', termBg: '#0f1016',
      line: '#2b2c38', text: '#efedf5', textDim: '#aaa7b8', textFaint: '#858296',
      accent: '#f2a65e', accentInk: '#2a1500', accentSoft: '#36261a',
      ok: '#4cc38a', okSoft: '#122a20', warn: '#f0c75a', warnSoft: '#2e2810',
      danger: '#f2696b', dangerSoft: '#361a1c',
      info: '#7cb8ff', infoSoft: '#14223a'
    }
  },
  {
    id: 'day',
    name: 'Day',
    scheme: 'light',
    colors: {
      bg: '#f4f4f6', panel: '#ffffff', elevated: '#eaebee', hover: '#eff0f2', termBg: '#ffffff',
      line: '#dcdee3', text: '#16171b', textDim: '#4d515b', textFaint: '#666a75',
      accent: '#4a52d0', accentInk: '#ffffff', accentSoft: '#e8e9fb',
      ok: '#137a3d', okSoft: '#ddf2e4', warn: '#875a00', warnSoft: '#fbefd6',
      danger: '#c22f30', dangerSoft: '#fce4e4',
      info: '#1d5fa8', infoSoft: '#dfeaf7'
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
