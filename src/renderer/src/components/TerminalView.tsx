import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { RollStateEvent, SchedStateEvent, SessionInfo } from '../../../core/types'
import { nextResize, repaintNudge, REPAINT_NUDGE_MS, type Dims } from '../../../core/terminal/resize'
import { xtermThemeOf } from '../../../core/theme/apply'
import { NOTE_RESERVE_PX, PaneSize, showOwn, showPty, tileScale, wantedOf } from '../lib/terminalScale'
import { pinCursorBlinkOff } from '../lib/cursorBlink'
import * as sessionBus from '../lib/sessionBus'
import { useI18n } from '../i18n/I18nProvider'
import { useTerminalFont } from '../lib/terminalFont'
import { useTheme } from '../lib/theme'
import { attachConsoleLinks } from '../terminalLinks'
import { SessionStateBanners } from './SessionStateBanners'
import { terminalMayTakeFocus } from '../lib/terminalFocus'
import { registerDockable } from './wall/consoleDock'
import { exitWording } from '../../../core/sessions/exitWording'
import { RunFindBar } from './RunFindBar'
import { attachTerminalKeys, useTerminalFind, useTerminalMenu, type TerminalClipboard } from './terminalMenu'
import { Button, Icon } from './ui'

/** W9-H: a wall tile's font (DESIGN §2: the session's own xterm at 10.5–11px). */
export const TILE_FONT = 11
/** What a full-size console leaves of the Agents page for the terminal: the details panel, the strip and the header. */
const TILE_PAGE_RESERVE = { width: 330, height: 80 }
/** The tile's left and right margin around its terminal (wall.css `.wall-tile__term > .xterm`). */
const TILE_INSET_PX = 16

export function TerminalView({
  session,
  onRestart,
  rollState = null,
  schedState = null,
  active = false,
  onOpenUrl,
  onOpenFile,
  onOpenFolder
}: {
  session: SessionInfo
  onRestart: (old: SessionInfo) => void
  rollState?: RollStateEvent | null
  schedState?: SchedStateEvent | null
  active?: boolean
  onOpenUrl: (url: string, ev: MouseEvent) => void
  /** A path link was activated — the path main resolved, and the line/column the output named */
  onOpenFile: (path: string, at: { line?: number; col?: number }) => void
  /** A folder link's click (D2, 2026-10-14): the App reveals it in its explorer or opens the system file manager. */
  onOpenFolder?: (path: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const { family } = useTerminalFont()
  const { theme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const clipRef = useRef<TerminalClipboard | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const find = useTerminalFind(termRef, theme, findOpen, setFindOpen)
  const { onContextMenu, menu } = useTerminalMenu(clipRef, t)
  const attachFindRef = useRef(find.attach)
  attachFindRef.current = find.attach
  const onOpenUrlRef = useRef(onOpenUrl)
  onOpenUrlRef.current = onOpenUrl
  const onOpenFileRef = useRef(onOpenFile)
  onOpenFileRef.current = onOpenFile
  const onOpenFolderRef = useRef(onOpenFolder)
  onOpenFolderRef.current = onOpenFolder
  // Set by the construction effect so the font effect can reuse its lastSent-guarded fit
  // instead of calling window.api.sessions.resize directly (which would bypass the guard and leave
  // its lastSent stale for the next ResizeObserver-driven call)
  const fitRef = useRef<(() => void) | null>(null)
  /** The pty is shown at a controller's size: a controller on another computer typed last (terminalScale.ts). */
  const [sizedRemote, setSizedRemote] = useState(false)
  // A resumed session has a delay while claude reads and replays the whole conversation, so show a loading indicator until the first output
  const [loading, setLoading] = useState(Boolean(session.resumeSessionId))
  /** W9-H: a wall tile has borrowed this terminal (components/wall/consoleDock.ts); the pane does not focus it then. */
  const tiledRef = useRef(false)

  useEffect(() => {
    const host = hostRef.current!
    const term = new Terminal({
      fontSize: 14,
      // Matches the Windows PowerShell console font: Cascadia (the Win11 Terminal default) → Consolas (classic conhost) → fallbacks.
      // 'Malgun Gothic' is the slot for Hangul: none of the three fonts before it carry Hangul glyphs, so the
      // lookup used to fall through to the generic monospace, where Chromium picked Gulim — that made Hangul
      // (and only Hangul) look different from PowerShell, which falls back to Malgun Gothic via DirectWrite.
      // Order is what splits the roles: Latin is claimed by Cascadia Mono first, Hangul by Malgun Gothic.
      // This is the chain `family` resolves to when the user hasn't configured a font.
      fontFamily: family,
      scrollback: 5000,
      theme: xtermThemeOf(theme)
    })
    // If a program run inside the session changes the cursor style and does not restore it, only that tab's cursor blinks
    const blinkGuard = pinCursorBlinkOff(term)
    const detachFind = attachFindRef.current(term)
    term.open(host)
    // URLs and paths in the output are links. A path is resolved by main — against the agent's current
    // directory (its statusLine payload), then the session's cwd — and is a link only when a regular
    // file is there (files.resolveLink); an agent printing where it put a rendered clip is the case
    // this is for. A session whose CLI writes no statusLine (codex) has the cwd alone, so after a `cd`
    // a relative path misses, which is no link, not a wrong one.
    const cwd = session.cwd
    const sessionId = session.id
    const disposeLinks = attachConsoleLinks(term, {
      onUrl: (url, ev) => onOpenUrlRef.current(url, ev),
      // The session id lets main try the agent's current directory first: Claude Code prints a sent
      // file relative to wherever its Bash tool `cd`'d, not to the session's cwd
      resolvePath: (target) => window.api.files.resolveLink(cwd, target, sessionId, { dirs: true }).catch(() => null),
      onOpenFile: (path, at) => onOpenFileRef.current(path, at),
      onOpenFolder: (path) => onOpenFolderRef.current?.(path)
    })
    termRef.current = term
    // The dimensions last sent to the PTY — stops a resize of the same size from being re-sent on a tab
    // switch (display:none→flex), which would push claude's interactive TUI around
    let lastSent: Dims | null = null
    let nudgeTimer: ReturnType<typeof setTimeout> | undefined
    // The size follows the side that typed last (the Host's registry `sizeOwner`): while a controller on another
    // computer owns it, this tab shows the pty whole at a smaller font instead of cutting rows off, and says so.
    const pane = new PaneSize()
    /** W9-H tile mode: where a wall tile has put this terminal, or null while it is in its pane. */
    let tiled: HTMLElement | null = null
    /** A tile shows the pty at the pty's own size in the tile font, bottom rows in view (wall.css), and sends no
     *  resize: the tile is a window on the console, and the pane or the full-size console owns its size. */
    const fitTile = (): void => {
      let pty = pane.pty ?? lastSent
      // A console never shown in a pane has sent no size and heard none, so the TUI paints at its spawn size, which
      // this xterm does not know. It gets the size its full-size console would ask for (the Agents page less the header
      // and the details panel), sent once, as opening it would.
      const page = tiled?.closest('.agents-page')
      if (!pty && page) {
        const area = { clientWidth: page.clientWidth - TILE_PAGE_RESERVE.width, clientHeight: page.clientHeight - TILE_PAGE_RESERVE.height }
        const d = wantedOf(term, area as HTMLElement)
        if (d) {
          // The first send goes a row short and the real size follows, as fitNow's does (repaintNudge), so a TUI
          // reattached after a reload repaints instead of staying blank.
          const nudge = repaintNudge(d)
          if (nudge) {
            pane.sent(nudge)
            window.api.sessions.resize(session.id, nudge.cols, nudge.rows)
            nudgeTimer = setTimeout(() => {
              if (lastSent) window.api.sessions.resize(session.id, lastSent.cols, lastSent.rows)
            }, REPAINT_NUDGE_MS)
          } else window.api.sessions.resize(session.id, d.cols, d.rows)
          pane.sent(d)
          lastSent = d
          pty = d
        }
      }
      if (term.options.fontSize !== TILE_FONT) term.options.fontSize = TILE_FONT
      if (pty && (term.cols !== pty.cols || term.rows !== pty.rows)) term.resize(pty.cols, pty.rows)
      scaleTile()
    }
    /** W11: a pty wider than its tile is drawn smaller, never cut at the right edge. The transform leaves the cell
     *  grid (and so the pty's size) alone; the anchor's bottom-left origin keeps the bottom rows in view (wall.css). */
    const scaleTile = (): void => {
      const el = term.element
      if (!tiled || !el || el.offsetWidth === 0) return
      const s = tileScale(tiled.clientWidth - TILE_INSET_PX, el.offsetWidth, TILE_FONT)
      el.style.transform = s < 1 ? `scale(${s})` : ''
    }
    const tileObserver = new ResizeObserver(() => scaleTile())
    /** Asks the pty for the grid this pane holds at the base font (the cell grid directly, not FitAddon, which always
     *  subtracts 15px for a scrollbar), and draws its own grid or the pty's size, whichever it owns. */
    const fitNow = (): void => {
      if (tiled) return fitTile()
      const wanted = wantedOf(term, host)
      if (!wanted) return
      const d = nextResize(lastSent, wanted.cols, wanted.rows)
      if (d) {
        // This pane's first send goes a row short, and the real size follows a moment later, so a reattached
        // TUI repaints over the replay instead of staying blank (repaintNudge). The timer sends whatever was
        // sent last by then, so a resize in between is never undone.
        const nudge = lastSent === null ? repaintNudge(d) : null
        if (nudge) {
          pane.sent(nudge)
          window.api.sessions.resize(session.id, nudge.cols, nudge.rows)
          nudgeTimer = setTimeout(() => {
            if (lastSent) window.api.sessions.resize(session.id, lastSent.cols, lastSent.rows)
          }, REPAINT_NUDGE_MS)
        }
        pane.sent(d)
        if (!nudge) window.api.sessions.resize(session.id, d.cols, d.rows)
        lastSent = d
      }
      const note = pane.note(wanted)
      const shows = pane.shows()
      if (shows === 'own') showOwn(term, host)
      else showPty(term, host, shows, note ? NOTE_RESERVE_PX : 0)
      setSizedRemote(note)
    }
    fitRef.current = fitNow
    fitNow()
    // W9-H: the wall borrows this very xterm for a tile. It is never a second terminal and never a re-attach: the
    // element moves, the bus keeps writing into the same buffer. Offscreen, xterm's own IntersectionObserver
    // (RenderService) pauses drawing while the output is still parsed, so a tile scrolled away costs no paint.
    const offDock = registerDockable(sessionId, {
      show: (anchor) => {
        const el = term.element
        if (!el) return
        tiled = anchor
        tiledRef.current = true
        anchor.appendChild(el)
        tileObserver.observe(anchor)
        tileObserver.observe(el)
        term.options.disableStdin = true // read-only until opened: a click on the tile opens the console
        term.blur()
        fitTile()
        term.scrollToBottom()
      },
      home: () => {
        const el = term.element
        if (!el) return
        tiled = null
        tiledRef.current = false
        tileObserver.disconnect()
        el.style.transform = ''
        host.appendChild(el)
        term.options.disableStdin = false
        fitNow()
      },
      focus: () => {
        if (!tiled) term.focus()
      }
    })
    const offSize = window.api.on('session:pty-size', (e) => {
      if (e.sessionId !== session.id) return
      // The Host's word on who owns the size, beside the size (final review I7).
      pane.heard({ cols: e.cols, rows: e.rows }, e.owned)
      fitNow()
    })
    // so typing works immediately once the session opens, unless the person is typing elsewhere (W4: the command bar)
    if (terminalMayTakeFocus(document.activeElement)) term.focus()

    // On macOS, terminal copy/paste is Cmd. Ctrl+C must always flow through as an interrupt — swallowing
    // it just because a selection is active is, to a mac user, simply a 'Ctrl+C doesn't work' bug.
    const isMac = window.api.platform === 'darwin'
    // Ctrl+Enter → newline. A terminal sends Ctrl+Enter as a plain Enter (submit) by default, so the
    // same sequence as Alt+Enter (ESC+CR) is sent directly to make claude treat it as a newline
    // (restores the behavior from the PowerShell days). Copy / paste / find are the shared handler's
    // (terminalMenu.ts, which also keeps the selection latched for a TUI that repaints every frame).
    clipRef.current = attachTerminalKeys(term, {
      isMac,
      onFind: () => setFindOpen(true),
      before: (e) => {
        if (e.type === 'keydown' && e.key === 'Enter' && e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          window.api.sessions.write(session.id, '\x1b\r')
          return true // keeps xterm's default (Enter = submit) from running
        }
        return false
      }
    })

    // When to drop the resume loading overlay: the first bytes are a meaningless startup sequence
    // (measured at 16B, +17~28ms), so clearing on those makes the overlay vanish instantly. Measurement
    // shows claude's replayed content arrives as a burst at ~2.5s+, after the initial noise (~0.5s), so
    // it clears on "output that arrived after the startup grace (800ms)" or "3KB accumulated"
    // (plus a 15s safety net).
    const mountT = performance.now()
    let cum = 0
    let hidden = false
    const hideLoading = (): void => {
      if (hidden) return
      hidden = true
      setLoading(false)
    }
    const loadingSafety = setTimeout(hideLoading, 15_000)
    const detach = sessionBus.attach(session.id, (data) => {
      cum += data.length
      if (performance.now() - mountT > 800 || cum >= 3000) hideLoading()
      // the write callback = an ack that the renderer consumed it → backpressure
      term.write(data, () => window.api.sessions.ack(session.id, data.length))
    })
    // Design Mode's "send to session" pastes here — the same path as Ctrl+V, so the prompt arrives
    // bracketed and unsubmitted (sessionBus.registerPaste explains why not sessions.write)
    const unregisterPaste = sessionBus.registerPaste(session.id, (text) => term.paste(text))
    // The live screen, so a send can tell an agent at its prompt from one holding a dialog open.
    // One screen's worth rather than the whole scrollback: a dialog answered ten minutes ago is not
    // what is waiting now, and `translateToString(true)` trims the padding a TUI draws to the right edge.
    //
    // **baseY, not viewportY.** viewportY follows where the person has scrolled this terminal to, and
    // the readers of this are not asking "what is he looking at" but "what is the CLI showing" — the
    // conversation view builds its prompt and the buttons to answer it out of this, and a session
    // scrolled up a few lines handed back a screen with the dialog's rows missing, so there was
    // nothing to build them from. baseY is the top of the live screen whatever the scrollback is
    // doing, which is the question actually being asked.
    const unregisterScreen = sessionBus.registerScreen(session.id, () => {
      const buffer = term.buffer.active
      const rows: string[] = []
      for (let i = 0; i < term.rows; i += 1) {
        const line = buffer.getLine(buffer.baseY + i)
        if (line) rows.push(line.translateToString(true))
      }
      return rows.join('\n')
    })
    const input = term.onData((d) => window.api.sessions.write(session.id, d))
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (host.clientWidth === 0 || host.clientHeight === 0) return
        fitNow() // only sends when the dimensions actually changed (keeps a tab switch from shifting the TUI)
      }, 60)
    })
    observer.observe(host)

    return () => {
      offDock()
      tileObserver.disconnect()
      // A tile holding the terminal when the session's view goes: take it back so dispose removes it from the page.
      if (tiled && term.element) host.appendChild(term.element)
      disposeLinks()
      clipRef.current?.dispose()
      clipRef.current = null
      detachFind()
      detach()
      blinkGuard.dispose()
      input.dispose()
      observer.disconnect()
      clearTimeout(resizeTimer)
      clearTimeout(nudgeTimer)
      clearTimeout(loadingSafety)
      offSize()
      termRef.current = null
      fitRef.current = null
      unregisterPaste()
      unregisterScreen()
      term.dispose()
    }
  }, [session.id])

  // The font is applied through options rather than by rebuilding the terminal — the construction
  // effect is keyed by session id, and adding the font to it would tear the terminal down and take the
  // screen and the scrollback with it. Changing the font changes the cell metrics, so the grid is
  // refitted and the new size sent to the PTY; nextResize's guard drops the send when the grid works
  // out the same.
  useEffect(() => {
    const term = termRef.current
    const host = hostRef.current
    if (!term || !host) return
    term.options.fontFamily = family
    // A hidden inactive pane has clientWidth/clientHeight 0; a grid measured then would clamp through
    // Math.max(2, 0) and resize the grid down to 2x1, pushing that size to the PTY too. Skip the
    // refit while hidden — the same guard the ResizeObserver below already applies — and let showing
    // the tab (which changes the host size and fires the observer) refit it with real metrics then.
    if (host.clientWidth === 0 || host.clientHeight === 0) return
    fitRef.current?.()
  }, [family, session.id])

  // Recolour only when the theme changes. Recreating would wipe the scrollback — this file's convention.
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = xtermThemeOf(theme)
  }, [theme])

  // When this tab becomes active (including keyboard switching and a tab click), focus the terminal so typing works right away
  useEffect(() => {
    if (active && !tiledRef.current && session.status !== 'exited' && terminalMayTakeFocus(document.activeElement)) termRef.current?.focus()
  }, [active, session.status])

  const exit = exitWording(session.exitCode, { closedByAstera: session.closedByAstera, closeReason: session.closeReason })
  return (
    <div className="terminal-wrap" onContextMenu={onContextMenu}>
      <div className="terminal-host" ref={hostRef} />
      {findOpen && <RunFindBar {...find.barProps} />}
      {menu}
      <SessionStateBanners sessionId={session.id} rollState={rollState} schedState={schedState} />
      {sizedRemote && session.status !== 'exited' && (
        <div className="remote-session-banners">
          <div className="remote-session-banner">{t('session.terminal.sizedRemote')}</div>
        </div>
      )}
      {loading && session.status !== 'exited' && (
        <div className="loading-overlay">
          <span className="loading-spinner" aria-hidden="true" />
          {t('session.terminal.loadingContent')}
        </div>
      )}
      {session.status === 'exited' && (
        <div className="exit-overlay">
          <p>{t(exit.key, exit.params)}</p>
          <Button variant="primary" icon={<Icon name="refresh" />} onClick={() => onRestart(session)}>
            {t('session.terminal.restart')}
          </Button>
        </div>
      )}
    </div>
  )
}
