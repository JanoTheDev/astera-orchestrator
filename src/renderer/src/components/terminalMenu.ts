// What every xterm terminal in the app shares: the right-click menu, the copy / paste / find keys and the find bar's
// state. TerminalView, TerminalBody, RunPanel and RemoteTerminalView each used to carry (or lack) their own copy.
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { copyTextFor } from '../../../core/terminal/copy'
import { findHighlightPaint } from '../../../core/run/consoleTerminal'
import { xtermThemeOf } from '../../../core/theme/apply'
import type { Theme } from '../../../core/theme/themes'
import type { MessageKey } from '../../../core/i18n'
import { Menu, menuPointOf, type MenuItem } from './ui'

export type TerminalAction = 'copy' | 'paste' | 'selectAll' | 'clear' | 'find'

export type TerminalMenuEntry = { action: TerminalAction; disabled?: boolean } | 'separator'

/** The right-click menu, in order. Copy is disabled while nothing is selected. */
export function terminalMenuEntries(hasSelection: boolean): TerminalMenuEntry[] {
  return [
    { action: 'copy', disabled: !hasSelection },
    { action: 'paste' },
    'separator',
    { action: 'selectAll' },
    { action: 'clear' },
    'separator',
    { action: 'find' }
  ]
}

type KeyLike = Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/** Which shared action a key press asks for, or null to let it through to the process. Copy and paste use Cmd on macOS
 *  (Ctrl+C there stays the interrupt) and Ctrl elsewhere. Find is Cmd+F on macOS and Ctrl+Shift+F elsewhere, because a
 *  shell or a TUI owns plain Ctrl+F; `plainFind` (the run console, which is not interactive) also takes Ctrl+F. */
export function terminalKeyAction(e: KeyLike, isMac: boolean, plainFind = false): 'copy' | 'paste' | 'find' | null {
  if (e.type !== 'keydown' || e.altKey) return null
  const mod = isMac ? e.metaKey : e.ctrlKey
  const other = isMac ? e.ctrlKey : e.metaKey
  if (!mod || other) return null
  const key = e.key.toLowerCase()
  if (key === 'c') return e.shiftKey ? null : 'copy'
  if (key === 'v') return 'paste'
  if (key === 'f') return e.shiftKey === !isMac || (plainFind && !e.shiftKey) ? 'find' : null
  return null
}

export type TerminalClipboard = {
  hasSelection: () => boolean
  run: (action: TerminalAction) => void
  dispose: () => void
}

/** Installs the one key handler and returns the actions the menu runs. `before` sees the key first (a terminal's own
 *  keys, e.g. Ctrl+Enter) and returns true when it consumed it. The selection is latched when it is made: a TUI that
 *  repaints the screen leaves xterm's coordinates pointing at something else by the time Copy is pressed
 *  (core/terminal/copy.ts has the measurement). */
export function attachTerminalKeys(
  term: Terminal,
  o: {
    isMac: boolean
    plainFind?: boolean
    readOnly?: () => boolean
    onFind?: () => void
    /** Runs after the menu's Clear has cleared the terminal, for state that describes its old contents (find matches) */
    onClear?: () => void
    before?: (e: KeyboardEvent) => boolean
  }
): TerminalClipboard {
  // 고른 순간의 글자를 붙잡아 둔다 — TerminalView 와 같은 이유이고 같은 방식이다. xterm 의
  // 선택은 좌표만 가리키므로, 실행된 명령이 화면을 다시 그리면(TUI 를 띄우는 명령이 그렇다)
  // 그 좌표에서 읽히는 것은 이미 다른 것이다. core/terminal/copy.ts 에 그 측정이 있다.
  let latched = ''
  const latch = term.onSelectionChange(() => {
    latched = term.getSelection()
  })
  const copy = (): boolean => {
    const text = copyTextFor(latched, term.getSelection())
    // 쓸 것이 없으면 클립보드를 그대로 둔다 — 다시 그려진 자리의 공백으로 덮어쓰면 복사한
    // 사람은 붙여넣기가 고장 난 것으로 본다.
    if (text === null) return false
    window.api.clipboard.writeText(text)
    term.clearSelection()
    latched = ''
    return true
  }
  const run = (action: TerminalAction): void => {
    if (action === 'copy') copy()
    else if (action === 'paste') {
      const text = window.api.clipboard.readText()
      if (text && !o.readOnly?.()) term.paste(text)
    } else if (action === 'selectAll') term.selectAll()
    else if (action === 'clear') {
      term.clear()
      o.onClear?.()
    }
    else if (o.onFind) return o.onFind()
    term.focus()
  }
  term.attachCustomKeyEventHandler((e) => {
    if (o.before?.(e)) return false
    const action = terminalKeyAction(e, o.isMac, o.plainFind)
    // With nothing selected a copy key flows through (Ctrl+C is the interrupt on Windows and Linux)
    if (action === 'copy') return !copy()
    // preventDefault stops the browser's own paste, which xterm would write a second time
    if (action === 'paste') {
      e.preventDefault()
      run('paste')
      return false
    }
    if (action === 'find' && o.onFind) {
      o.onFind()
      return false
    }
    return true
  })
  return {
    hasSelection: () => copyTextFor(latched, term.getSelection()) !== null,
    run,
    dispose: () => latch.dispose()
  }
}

const MENU_LABEL: Record<TerminalAction, MessageKey> = {
  copy: 'terminal.menu.copy',
  paste: 'terminal.menu.paste',
  selectAll: 'terminal.menu.selectAll',
  clear: 'terminal.menu.clear',
  find: 'terminal.menu.find'
}

/** Whether a right-click landed on the xterm surface. The wrapper also holds the find bar, banners and overlays, which
 *  keep their own menus (the native input menu in the find field, for one). */
export function isXtermTarget(target: EventTarget | null): boolean {
  return (target as Element | null)?.closest?.('.xterm') != null
}

/** The right-click menu of a terminal: `onContextMenu` goes on its wrapper, `menu` is drawn beside the terminal. */
export function useTerminalMenu(
  clip: RefObject<TerminalClipboard | null>,
  t: (key: MessageKey) => string
): { onContextMenu: (e: React.MouseEvent) => void; menu: ReactElement | null } {
  const [open, setOpen] = useState<{ at: { x: number; y: number }; hasSelection: boolean } | null>(null)
  const onContextMenu = (e: React.MouseEvent): void => {
    if (!isXtermTarget(e.target)) return
    e.preventDefault()
    setOpen({ at: menuPointOf(e), hasSelection: clip.current?.hasSelection() ?? false })
  }
  const items: Array<MenuItem | 'separator'> = terminalMenuEntries(open?.hasSelection ?? false).map((entry) =>
    entry === 'separator'
      ? entry
      : { label: t(MENU_LABEL[entry.action]), disabled: entry.disabled, onSelect: () => clip.current?.run(entry.action) }
  )
  return {
    onContextMenu,
    menu: open ? createElement(Menu, { at: open.at, items, onClose: () => setOpen(null) }) : null
  }
}

/** The app's amber, which both the find highlights and the console's selection colour are built from.
 *  Read from the theme rather than hardcoded; the fallback is the value every shipped theme defines. */
export function findHighlightColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--warn').trim() || '#d9a441'
}

/** The search addon's highlight colours. Every match is one colour: a decoration's background and xterm's selection
 *  background (which the active match sits inside, since the addon selects it) follow different paint rules, so the
 *  same input colour came out as two pixels — see findHighlightPaint. The active match is told apart by its outline. A
 *  function of the paint, not a copy of it, so this and consoleTerminalOptions (the selection side) cannot drift. */
function searchDecorations(theme: Theme): ISearchOptions['decorations'] {
  const xtermTheme = xtermThemeOf(theme)
  const paint = findHighlightPaint({
    highlight: findHighlightColor(),
    background: xtermTheme.background,
    outline: xtermTheme.foreground
  })
  return {
    matchBackground: paint.decorationBackground,
    activeMatchBackground: paint.decorationBackground,
    activeMatchBorder: paint.activeBorder,
    matchOverviewRuler: paint.ruler,
    activeMatchColorOverviewRuler: paint.ruler
  }
}

/** The state behind a terminal's RunFindBar. `attach(term)` loads the search addon in the terminal's construction
 *  effect and returns its disposer. `open` is the caller's, so a parent can own it (the run console's is per run).
 *  Typing searches incrementally; closing clears the highlights, keeps the query and hands focus back. */
export function useTerminalFind(
  termRef: RefObject<Terminal | null>,
  theme: Theme,
  open: boolean,
  onOpenChange: (open: boolean) => void
): {
  attach: (term: Terminal) => () => void
  barProps: {
    query: string
    results: { index: number | null; total: number } | null
    onQueryChange: (q: string) => void
    onNext: () => void
    onPrev: () => void
    onClose: () => void
  }
  reset: () => void
} {
  const searchRef = useRef<SearchAddon | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ index: number | null; total: number } | null>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  const attach = useCallback((term: Terminal): (() => void) => {
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
    // resultIndex -1: the addon stopped tracking the active match (its highlightLimit); the total is still right
    const sub = search.onDidChangeResults((e) =>
      setResults({ index: e.resultIndex < 0 ? null : e.resultIndex + 1, total: e.resultCount })
    )
    return () => {
      sub.dispose()
      searchRef.current = null
    }
  }, [])

  // clearSelection alongside clearDecorations: the addon's clearDecorations() leaves the active match selected
  const reset = useCallback((): void => {
    searchRef.current?.clearDecorations()
    termRef.current?.clearSelection()
    setResults(null)
  }, [termRef])

  const options = (incremental: boolean): ISearchOptions => ({
    caseSensitive: false,
    regex: false,
    incremental,
    decorations: searchDecorations(theme)
  })
  // Not on mount: a terminal appearing must not take focus from wherever the person is typing
  const wasOpen = useRef(open)
  useEffect(() => {
    const was = wasOpen.current
    wasOpen.current = open
    if (open) return
    reset()
    if (was) termRef.current?.focus()
  }, [open, reset, termRef])

  return {
    attach,
    reset,
    barProps: {
      query,
      results,
      onQueryChange: (q) => {
        setQuery(q)
        if (q) searchRef.current?.findNext(q, options(true))
        else reset()
      },
      onNext: () => {
        if (query) searchRef.current?.findNext(query, options(false))
      },
      onPrev: () => {
        if (query) searchRef.current?.findPrevious(query, options(false))
      },
      onClose: () => onOpenChangeRef.current(false)
    }
  }
}
