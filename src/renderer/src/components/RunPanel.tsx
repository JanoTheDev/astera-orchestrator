import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { xtermThemeOf } from '../../../core/theme/apply'
import { consoleTerminalOptions } from '../../../core/run/consoleTerminal'
import { pinCursorBlinkOff } from '../lib/cursorBlink'
import { useTerminalFont } from '../lib/terminalFont'
import { useTheme } from '../lib/theme'
import { attachConsoleLinks } from '../terminalLinks'
import { useI18n } from '../i18n/I18nProvider'
import { attachTerminalKeys, findHighlightColor, useTerminalFind, useTerminalMenu, type TerminalClipboard } from './terminalMenu'
import { RunFindBar } from './RunFindBar'
import { createReplayJoin } from '../lib/runReplay'

/** One run's console. The tab strip, the tool rail and the header are owned by BottomPanel; this draws
 *  xterm, plus the two things that live on the terminal itself: the link provider (shared —
 *  terminalLinks.ts; a file path in the output opens the file at that line, a URL opens the preview or
 *  the browser) and the search addon with its find bar.
 *  clearNonce / scrollToEndNonce: counters BottomPanel bumps for this run. */
export function RunPanel({
  runId,
  clearNonce,
  scrollToEndNonce,
  findOpen,
  onFindOpenChange,
  onOpenFile,
  onOpenUrl
}: {
  runId: string
  clearNonce: number
  scrollToEndNonce: number
  /** Whether this run's find bar is shown. Owned by BottomPanel so it is per run and survives a tab switch. */
  findOpen: boolean
  onFindOpenChange: (open: boolean) => void
  /** A path link was activated — resolved by main already, so `path` is absolute and exists */
  onOpenFile: (path: string, at: { line?: number; col?: number }) => void
  /** A URL link was activated. App's link rule decides preview or outside; the event carries Ctrl/Cmd. */
  onOpenUrl: (url: string, ev: MouseEvent) => void
}): React.JSX.Element {
  const { family } = useTerminalFont()
  const { theme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const clipRef = useRef<TerminalClipboard | null>(null)
  const { t } = useI18n()
  const find = useTerminalFind(termRef, theme, findOpen, onFindOpenChange)
  const { onContextMenu, menu } = useTerminalMenu(clipRef, t)
  // The construction effect runs once per run and must not capture a stale callback
  const onFindOpenChangeRef = useRef(onFindOpenChange)
  onFindOpenChangeRef.current = onFindOpenChange
  const attachFindRef = useRef(find.attach)
  attachFindRef.current = find.attach
  const onOpenFileRef = useRef(onOpenFile)
  onOpenFileRef.current = onOpenFile
  const onOpenUrlRef = useRef(onOpenUrl)
  onOpenUrlRef.current = onOpenUrl

  // One xterm per run — a new one is created when runId changes
  useEffect(() => {
    const host = hostRef.current!
    const term = new Terminal(
      consoleTerminalOptions({ fontFamily: family, theme: xtermThemeOf(theme), findHighlight: findHighlightColor() })
    )
    // If the Run command (or one of its child processes) changes the cursor style and does not restore it, the cursor blinks
    const blinkGuard = pinCursorBlinkOff(term)
    const fit = new FitAddon()
    term.loadAddon(fit)
    const detachFind = attachFindRef.current(term)
    term.open(host)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    // Ctrl+F opens this run's find bar instead of sending the key to the process (the console is not interactive);
    // bound on the terminal, not the window, so the editor's own find is untouched. Copy with a selection must not
    // interrupt the server that printed the text: the shared handler lets Ctrl+C through only when nothing is selected.
    clipRef.current = attachTerminalKeys(term, {
      isMac: window.api.platform === 'darwin',
      plainFind: true,
      onFind: () => onFindOpenChangeRef.current(true)
    })
    const disposeLinks = attachConsoleLinks(term, {
      onUrl: (url, ev) => onOpenUrlRef.current(url, ev),
      resolvePath: (target) => window.api.run.resolveLink(runId, target).then((r) => r?.path ?? null, () => null),
      onOpenFile: (path, at) => onOpenFileRef.current(path, at)
    })
    // Reconnect: replay the buffered output first (the cancelled guard prevents a write after a switch or unmount). Live
    // output that raced the replay is held and written past where the replay ends (second pass R2-7: it was written
    // twice, out of order).
    let cancelled = false
    const join = createReplayJoin((s) => term.write(s))
    void window.api.run.replay(runId).then(
      (r) => {
        if (!cancelled) join.replay(r.text, r.end)
      },
      () => {
        if (!cancelled) join.replay('', 0)
      }
    )
    const off = window.api.on('run:data', (e) => {
      if (e.runId === runId) join.live(e.data, e.end)
    })
    const input = term.onData((d) => window.api.run.write(runId, d))
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (host.clientWidth === 0 || host.clientHeight === 0) return
        fit.fit()
        window.api.run.resize(runId, term.cols, term.rows)
      }, 60)
    })
    observer.observe(host)
    return () => {
      cancelled = true
      off()
      disposeLinks()
      clipRef.current?.dispose()
      clipRef.current = null
      detachFind()
      blinkGuard.dispose()
      input.dispose()
      observer.disconnect()
      clearTimeout(resizeTimer)
      termRef.current = null
      fitRef.current = null
      term.dispose()
    }
  }, [runId])

  // Same rationale as TerminalView's font effect: mutate options rather than widen the construction
  // effect's deps, then refit. This file has no onResize wiring — the ResizeObserver above sends the
  // resize directly, so the same call is made here.
  useEffect(() => {
    const term = termRef.current
    const host = hostRef.current
    if (!term || !host) return
    term.options.fontFamily = family
    // Same guard as the ResizeObserver above: a hidden Run tab has clientWidth/clientHeight 0, and
    // fit() would be a no-op, but the resize call below would still send a same-size resize to the
    // PTY on every font change and every mount.
    if (host.clientWidth === 0 || host.clientHeight === 0) return
    fitRef.current?.fit()
    window.api.run.resize(runId, term.cols, term.rows)
  }, [family, runId])

  // Recolour only when the theme changes. Recreating would wipe the scrollback — this file's convention.
  // Built through consoleTerminalOptions rather than xtermThemeOf directly, so the selection colour
  // (which xtermThemeOf does not carry) isn't dropped on a theme change.
  useEffect(() => {
    const term = termRef.current
    if (term) {
      term.options.theme = consoleTerminalOptions({
        fontFamily: family,
        theme: xtermThemeOf(theme),
        findHighlight: findHighlightColor()
      }).theme
    }
  }, [theme])

  useEffect(() => {
    if (clearNonce > 0) {
      termRef.current?.clear()
      // The matches went with the scrollback — a count with nothing behind it is worse than none.
      find.reset()
    }
  }, [clearNonce])

  useEffect(() => {
    if (scrollToEndNonce > 0) termRef.current?.scrollToBottom()
  }, [scrollToEndNonce])

  return (
    <div className="run-panel-body" onContextMenu={onContextMenu}>
      <div className="run-panel-host" ref={hostRef} />
      {findOpen && <RunFindBar {...find.barProps} />}
      {menu}
    </div>
  )
}
