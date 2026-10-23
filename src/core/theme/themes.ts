/** 한글 담당을 스택에 직접 적는다 — 스펙 §4.3, 그리고 themes.test.ts 가 이것을 검사한다. */
const HANGUL = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', sans-serif"
/** The UI face (DESIGN-W13.md §11): the platform's own UI font, as VSCode does. The bundled IBM Plex Sans
 *  files stay on disk but no stack names them. */
export const SANS = `system-ui, -apple-system, 'Segoe UI', Ubuntu, Cantarell, ${HANGUL}`
/** The app UI's code face. The terminal's mono chain (core/terminal/font.ts) is separate — that one the
 *  person picks in settings. */
export const DEFAULT_MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace"

/** A palette that exists. `system` is not one: it resolves to `night` or `day` (resolveThemeId). */
export type PaletteId = 'night' | 'dusk' | 'day'
/** What the person picks and what settings store. */
export type ThemeId = PaletteId | 'system'
export type Density = 'compact' | 'normal' | 'roomy'

/** The tokens of DESIGN-W13.md §11 (palette), one field per row of its table. */
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
  /** Accent-coloured words (links, the Markdown link). --accent is a fill and a mark; on the dark palettes
   *  it is under 4.5:1 as text, so text reads this one. */
  link: string
  // ---- the workbench (DESIGN-W13.md §2, §11): one field per VSCode-style surface ----
  activitybarBg: string
  activitybarFg: string
  activitybarFgDim: string
  sidebarBg: string
  editorBg: string
  tabBarBg: string
  tabActiveBg: string
  tabInactiveBg: string
  tabBorderActive: string
  panelBg: string
  panelBorder: string
  statusbarBg: string
  statusbarFg: string
  focusBorder: string
  listHover: string
  listActive: string
  listInactiveSelection: string
  badgeBg: string
  badgeFg: string
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
      bg: '#1f1f1f', panel: '#181818', elevated: '#2b2b2b', hover: '#2a2d2e', termBg: '#181818',
      line: '#2b2b2b', text: '#cccccc', textDim: '#9d9d9d', textFaint: '#8b8b8b',
      accent: '#0078d4', accentInk: '#ffffff', accentSoft: '#0f2b46',
      ok: '#6cc77a', okSoft: '#13291a', warn: '#d7ac2c', warnSoft: '#2e2810',
      danger: '#f47070', dangerSoft: '#3a1c1c',
      info: '#4daafc', infoSoft: '#122436', link: '#4daafc',
      activitybarBg: '#181818', activitybarFg: '#d7d7d7', activitybarFgDim: '#868686',
      sidebarBg: '#181818', editorBg: '#1f1f1f',
      tabBarBg: '#181818', tabActiveBg: '#1f1f1f', tabInactiveBg: '#181818', tabBorderActive: '#0078d4',
      panelBg: '#181818', panelBorder: '#2b2b2b', statusbarBg: '#181818', statusbarFg: '#cccccc',
      focusBorder: '#0078d4', listHover: '#2a2d2e', listActive: '#0f2b46', listInactiveSelection: '#37373d',
      badgeBg: '#0078d4', badgeFg: '#ffffff'
    }
  },
  {
    id: 'dusk',
    name: 'Dusk',
    scheme: 'dark',
    colors: {
      bg: '#1e2430', panel: '#191e28', elevated: '#2b3240', hover: '#262d3a', termBg: '#191e28',
      line: '#2c3341', text: '#d3d9e3', textDim: '#a1aabb', textFaint: '#8790a2',
      accent: '#1f76cc', accentInk: '#ffffff', accentSoft: '#11263d',
      ok: '#72c98a', okSoft: '#162b22', warn: '#dcb43e', warnSoft: '#302a16',
      danger: '#f27a7a', dangerSoft: '#3b2228',
      info: '#62b0f5', infoSoft: '#172a3f', link: '#62b0f5',
      activitybarBg: '#191e28', activitybarFg: '#d3d9e3', activitybarFgDim: '#7f889a',
      sidebarBg: '#191e28', editorBg: '#1e2430',
      tabBarBg: '#191e28', tabActiveBg: '#1e2430', tabInactiveBg: '#191e28', tabBorderActive: '#1f76cc',
      panelBg: '#191e28', panelBorder: '#2c3341', statusbarBg: '#191e28', statusbarFg: '#d3d9e3',
      focusBorder: '#1f76cc', listHover: '#262d3a', listActive: '#11263d', listInactiveSelection: '#323a4a',
      badgeBg: '#1f76cc', badgeFg: '#ffffff'
    }
  },
  {
    id: 'day',
    name: 'Day',
    scheme: 'light',
    colors: {
      bg: '#ffffff', panel: '#f8f8f8', elevated: '#e5e5e5', hover: '#f2f2f2', termBg: '#ffffff',
      line: '#e5e5e5', text: '#3b3b3b', textDim: '#5f5f5f', textFaint: '#717171',
      accent: '#005fb8', accentInk: '#ffffff', accentSoft: '#dbeaf9',
      ok: '#2a7a2e', okSoft: '#e6f3e7', warn: '#8a6100', warnSoft: '#fbf0d4',
      danger: '#c42b2b', dangerSoft: '#fbe4e4',
      info: '#005fb8', infoSoft: '#dfebf7', link: '#005fb8',
      activitybarBg: '#f8f8f8', activitybarFg: '#1f1f1f', activitybarFgDim: '#6e6e6e',
      sidebarBg: '#f8f8f8', editorBg: '#ffffff',
      tabBarBg: '#f8f8f8', tabActiveBg: '#ffffff', tabInactiveBg: '#f8f8f8', tabBorderActive: '#005fb8',
      panelBg: '#f8f8f8', panelBorder: '#e5e5e5', statusbarBg: '#f8f8f8', statusbarFg: '#3b3b3b',
      focusBorder: '#005fb8', listHover: '#f2f2f2', listActive: '#dbeaf9', listInactiveSelection: '#e4e6f1',
      badgeBg: '#005fb8', badgeFg: '#ffffff'
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
