import { withAlpha } from './color'
import { DEFAULT_MONO, SANS, type Density, type Theme } from './themes'

interface DensityValues {
  rowPadY: string
  tabbarH: string
  selH: string
  modalPad: string
}

/** 스펙 §4.2. 밀도는 눈에 보이는 네 곳만 연다 — styles.css 의 padding 140곳을 전부 토큰화하면
 *  테마 기능이 아니라 CSS 전면 재작성이 된다. */
export const DENSITY: Record<Density, DensityValues> = {
  compact: { rowPadY: '3px', tabbarH: '30px', selH: '26px', modalPad: '16px' },
  normal: { rowPadY: '4px', tabbarH: '34px', selH: '30px', modalPad: '20px' },
  roomy: { rowPadY: '6px', tabbarH: '38px', selH: '34px', modalPad: '24px' }
}

/** Shape is the same in every theme (DESIGN.md §9): flat buttons at radius 6, cards at 10, small marks at 4. */
const SHAPE = { radius: '6px', radiusLg: '10px', radiusSm: '4px', markerW: '2px' }
const SHADOW = {
  dark: { sm: '0 1px 2px rgba(0,0,0,.35)', lg: '0 10px 28px rgba(0,0,0,.55)' },
  light: { sm: '0 1px 2px rgba(22,24,29,.08)', lg: '0 10px 28px rgba(22,24,29,.16)' }
}

/** 테마를 CSS 변수 표로 펼친다. 프로바이더가 이 표를 documentElement 에 심는다.
 *  DOM 을 만지지 않으므로 여기 있다 — markdownView.ts 와 같은 분리.
 *  The names before `--hover` are the stylesheet's older ones, kept so every rule still reads them;
 *  each now derives from a §9 token. */
export function themeCssVars(theme: Theme): Record<string, string> {
  const c = theme.colors
  const d = DENSITY.normal
  const shadow = SHADOW[theme.scheme]
  return {
    '--bg': c.bg,
    '--rail': c.bg,
    '--panel': c.panel,
    '--elevated': c.elevated,
    '--surface-hover': c.hover,
    '--term-bg': c.termBg,
    '--line': c.line,
    '--line-soft': c.line,
    '--text': c.text,
    '--text-dim': c.textDim,
    '--text-faint': c.textFaint,
    '--rail-icon': c.textDim,
    '--accent': c.accent,
    '--accent-ink': c.accentInk,
    // The colour of the focus ring (--focus-ring in tokens.css is the shadow built from it); Tailwind's ring-* reads it too.
    '--ring': withAlpha(c.accent, 0.6),
    '--status-bg': c.panel,
    '--status-ink': c.textDim,
    // 프리뷰는 테마를 따라간다.
    '--md-bg': c.bg,
    '--md-text': c.text,
    '--md-code-bg': c.elevated,
    '--md-line': c.line,
    '--md-link': c.accent,
    '--btn-bg': c.accent,
    '--btn-ink': c.accentInk,
    '--btn-border': 'transparent',
    '--hover': c.hover,
    '--accent-soft': c.accentSoft,
    '--ok': c.ok,
    '--ok-soft': c.okSoft,
    '--ok-bg': c.okSoft,
    '--warn': c.warn,
    '--warn-soft': c.warnSoft,
    '--warn-bg': c.warnSoft,
    '--warn-ink': c.warn,
    '--danger': c.danger,
    '--danger-soft': c.dangerSoft,
    '--danger-bg': c.dangerSoft,
    '--info': c.info,
    '--info-soft': c.infoSoft,
    '--radius': SHAPE.radius,
    '--radius-lg': SHAPE.radiusLg,
    '--radius-sm': SHAPE.radiusSm,
    '--marker-w': SHAPE.markerW,
    '--shadow-sm': shadow.sm,
    '--shadow-lg': shadow.lg,
    '--row-pad-y': d.rowPadY,
    '--pane-tabbar-h': d.tabbarH,
    '--sel-h': d.selH,
    '--modal-pad': d.modalPad,
    '--sans': SANS,
    '--mono': DEFAULT_MONO,
    '--tracking': '0'
  }
}

/** xterm 이 받는 것. 세 개뿐인 이유는 스펙 §6.3 — ANSI 16색은 셸과 프로그램의 것이다. */
export function xtermThemeOf(theme: Theme): {
  background: string
  foreground: string
  cursor: string
} {
  return {
    background: theme.colors.termBg,
    foreground: theme.colors.text,
    cursor: theme.colors.accent
  }
}
