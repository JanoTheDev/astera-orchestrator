import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { themeCssVars } from '../../../core/theme/apply'
import {
  DEFAULT_THEME_ID,
  resolveThemeId,
  themeById,
  themeIdOf,
  type Theme,
  type ThemeId
} from '../../../core/theme/themes'

/** 첫 페인트용 미러. IPC 는 비동기라 응답을 기다리면 기본 테마로 한 프레임 그려진 뒤 바뀐다.
 *  localStorage 는 동기라 그것이 없다 — cm.md.viewMode 와 같은 패턴. */
const KEY = 'astera.theme'

/** Old ids (upstream's seven palettes) map to night, `light` to day — themeIdOf. */
function readMirror(): ThemeId {
  return themeIdOf(localStorage.getItem(KEY))
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function prefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? true
}

/** The palette an id shows right now: `system` asks the OS. */
function paletteOf(id: ThemeId): Theme {
  return themeById(resolveThemeId(id, prefersDark()))
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(themeCssVars(theme))) root.style.setProperty(name, value)
  // data-theme names the palette on screen (never `system`), so a rule that must differ per palette can
  // select on it; color-scheme makes native controls and scrollbars follow light or dark.
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.scheme
}

/** main.tsx 가 createRoot 전에 부른다. */
export function bootTheme(): void {
  applyTheme(paletteOf(readMirror()))
}

interface ThemeValue {
  /** The palette on screen. */
  theme: Theme
  /** What the person picked — may be `system`. */
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
}

const Ctx = createContext<ThemeValue>({
  theme: themeById(DEFAULT_THEME_ID),
  themeId: DEFAULT_THEME_ID,
  setThemeId: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [id, setId] = useState<ThemeId>(readMirror)

  useEffect(() => {
    // 정본은 main 이다. 미러와 다르면 정본으로 바꾸고 미러를 갱신한다.
    void window.api.settings
      .getTheme()
      .then((stored) => {
        const next = themeIdOf(stored)
        setId(next)
        localStorage.setItem(KEY, next)
      })
      .catch(() => {}) // 실패하면 미러 값이 남는다 — 앱은 계속 쓸 수 있어야 한다
  }, [])

  // Bumped when the OS flips light/dark, so `system` follows it live.
  const [, setOsTick] = useState(0)
  useEffect(() => {
    if (id !== 'system' || !window.matchMedia) return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = (): void => setOsTick((n) => n + 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [id])

  const theme = paletteOf(id)
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setThemeId = useCallback((next: ThemeId) => {
    setId(next) // 낙관적. 호출자가 실패를 알리고 되돌린다
    localStorage.setItem(KEY, next)
  }, [])

  return <Ctx.Provider value={{ theme, themeId: id, setThemeId }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeValue {
  return useContext(Ctx)
}
