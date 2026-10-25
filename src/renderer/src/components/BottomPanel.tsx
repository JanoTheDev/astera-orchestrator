import { useEffect, useRef, useState } from 'react'
import type { RunStatus, TerminalBuffer } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { useWheelScrollX } from '../hooks/useWheelScrollX'
import { RunPanel } from './RunPanel'
import { RunTabStrip } from './RunTabStrip'
import { TerminalBody } from './TerminalBody'
import { Icon, IconButton, Input, Menu, menuPointOf, Toolbar, type ToolbarItem } from './ui'

/**
 * Bottom panel. The Run tab and the project terminals share this one panel through tabs.
 * The tool row and the clear chrome are owned only here; the bodies (RunPanel, TerminalBody) draw nothing but xterm.
 * The Run tab's body is the selected run's console under the run selector. Every run has its own RunPanel, and the ones not selected stay mounted under
 * display:none — the same approach as the session tabs (TerminalView) and the terminal tabs below — so
 * their scrollback and their find state survive switching tabs.
 */
export function BottomPanel({
  runAvailable = true,
  runs,
  configIds,
  selectedRunId,
  onSelectRun,
  onStopRun,
  onRerun,
  onDismissRun,
  onOpenFile,
  onOpenFolder,
  onOpenUrl,
  onOpenPreview,
  terminals,
  terminalCwd,
  activeTab,
  onSelectTab,
  onNewTerminal,
  onCloseTerminal,
  only
}: {
  /** Whether to draw the Run tab. false when no project is set (the panel opened from home) — run
   *  configurations are per project, there is nothing to run at home, and an empty Run tab looks broken.
   *  Defaults to true so existing callers with a project are unchanged. */
  runAvailable?: boolean
  /** This project's runs, finished ones included, in seat order */
  runs: RunStatus[]
  /** ids of the project's configurations as the toolbar knows them — the rail disables ↻ for a run whose
   *  id is not among them */
  configIds: readonly string[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  onStopRun: (runId: string) => void
  /** Start that configuration again — the rail's ↻ */
  onRerun: (configId: string) => void
  /** Drop a finished run — the tab's ✕. Only ever offered on a finished run, so a live run cannot be lost here. */
  onDismissRun: (runId: string) => void
  /** A path link in a console or a terminal was activated — App opens the file at that line, or a
   *  media file in the viewer */
  onOpenFile: (path: string, at: { line?: number; col?: number }) => void
  /** A folder a project terminal's link named (D2, 2026-10-14); the run console links files only. */
  onOpenFolder?: (path: string) => void
  /** A URL link in a console or a terminal was activated — App's link rule routes it. */
  onOpenUrl: (url: string, ev: MouseEvent) => void
  /** Open a running server's address in a preview tab — the run tab's globe button. */
  onOpenPreview: (url: string) => void
  terminals: TerminalBuffer[]
  /** The folder the terminals were opened in — a relative path link in one resolves against it */
  terminalCwd: string | null
  activeTab: string
  onSelectTab: (tab: string) => void
  onNewTerminal: () => void
  onCloseTerminal: (id: string) => void
  /** DESIGN-W13 §6: the workbench panel's Output tab shows the run strip only, its Terminal tab the shells only. Both
   *  bodies stay mounted either way. */
  only: 'run' | 'terminal'
}): React.JSX.Element {
  const { t } = useI18n()
  // Clear means emptying a body's xterm — bump a per-body counter (a runId or a terminal id) and let the
  // body clear itself. Scroll-to-end works the same way for runs.
  const tabList = useRef<HTMLSpanElement>(null)
  useWheelScrollX(tabList)
  const [clearNonces, setClearNonces] = useState<Record<string, number>>({})
  const [scrollNonces, setScrollNonces] = useState<Record<string, number>>({})
  const bump = (set: typeof setClearNonces, key: string): void =>
    set((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
  // The find bar is per run, so switching tabs shows that run's search
  const [findOpen, setFindOpen] = useState<Record<string, boolean>>({})
  // A tab's name is local: no backend stores one, so a rename lasts until the panel is closed. An empty name
  // goes back to the numbered label.
  const [names, setNames] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const [tabMenu, setTabMenu] = useState<{ at: { x: number; y: number }; id: string } | null>(null)

  // One clock for the whole panel, ticking only while something is still alive. Finished runs are
  // computed from their own exitedAt, so the tick never changes their text.
  const anyRunning = runs.some((r) => r.status !== 'exited')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!anyRunning) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyRunning])

  const selectedRun = runs.find((r) => r.runId === selectedRunId) ?? null
  // A terminal tab is a span, so keyboard access is wired by hand: arrows, Home/End move focus along the row
  // (wrapping); Enter/Space select.
  const tabKeyDown =
    (tab: string) =>
    (e: React.KeyboardEvent): void => {
      if (e.target !== e.currentTarget) return
      const tabs = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
      const at = tabs.indexOf(e.currentTarget as HTMLElement)
      const to =
        e.key === 'ArrowRight' ? (at + 1) % tabs.length
        : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
        : e.key === 'Home' ? 0
        : e.key === 'End' ? tabs.length - 1
        : -1
      if (to >= 0) {
        e.preventDefault()
        tabs[to]?.focus()
        return
      }
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      onSelectTab(tab)
    }
  const runId = selectedRunId
  const noRun = selectedRun === null
  const runTools: ToolbarItem[] = [
    { id: 'stop', icon: <Icon name="stop" size={14} />, label: t('run.action.stop'), disabled: selectedRun?.status !== 'running', onClick: () => selectedRun && onStopRun(selectedRun.runId) },
    { id: 'rerun', icon: <Icon name="rerun" size={14} />, label: selectedRun && !configIds.includes(selectedRun.configId) ? t('run.rail.rerunGone') : t('run.action.rerun'), disabled: noRun || !configIds.includes(selectedRun.configId), onClick: () => selectedRun && onRerun(selectedRun.configId) },
    { id: 'end', icon: <Icon name="scrollToEnd" size={14} />, label: t('run.rail.scrollToEnd'), disabled: noRun, onClick: () => runId && bump(setScrollNonces, runId) },
    { id: 'clear', icon: <Icon name="clear" size={14} />, label: t('run.panel.clear'), disabled: noRun, onClick: () => runId && bump(setClearNonces, runId) },
    { id: 'find', icon: <Icon name="search" size={14} />, label: t('run.rail.find'), active: !!(runId && findOpen[runId]), disabled: noRun, onClick: () => runId && setFindOpen((prev) => ({ ...prev, [runId]: !prev[runId] })) }
  ]
  const terminalTools: ToolbarItem[] = [
    { id: 'new', icon: <Icon name="add" size={14} />, label: t('terminal.tab.new'), onClick: onNewTerminal },
    { id: 'clear', icon: <Icon name="clear" size={14} />, label: t('run.panel.clear'), disabled: !terminals.some((x) => x.id === activeTab), onClick: () => bump(setClearNonces, activeTab) },
    { id: 'kill', icon: <Icon name="delete" size={14} />, label: t('terminal.tab.close'), disabled: !terminals.some((x) => x.id === activeTab), onClick: () => onCloseTerminal(activeTab) }
  ]
  return (
    <div className="run-panel">
      {/* DESIGN-W13 §6: one 30px tool row under the panel's own tabs. Output: the run selector on the right of the
          selected run's command, then Stop / Rerun / Scroll / Clear / Find. Terminal: the shells listed on the right,
          then + / Clear / Kill. */}
      <div className="bottom-tabs">
        {only === 'run' ? (
          <RunTabStrip runs={runs} selectedId={selectedRunId} now={now} onSelect={onSelectRun} onDismiss={onDismissRun} onOpenPreview={onOpenPreview} />
        ) : (
          <span ref={tabList} className="bottom-tab-list" role="tablist" aria-label={t('panel.terminals')}>
            {terminals.map((term, i) => (
              <span
                key={term.id}
                role="tab"
                aria-selected={activeTab === term.id}
                tabIndex={0}
                className={activeTab === term.id ? 'bottom-tab on' : 'bottom-tab'}
                onClick={() => onSelectTab(term.id)}
                onKeyDown={tabKeyDown(term.id)}
                onAuxClick={(e) => {
                  if (e.button !== 1) return
                  e.preventDefault()
                  onCloseTerminal(term.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setTabMenu({ at: menuPointOf(e), id: term.id })
                }}
              >
                {/* The number in the label is the display order in the current list — creation order is not remembered */}
                <Icon name="terminal" size={14} />
                {renaming === term.id ? (
                  <Input
                    autoFocus
                    defaultValue={names[term.id] || t('terminal.tab.label', { n: i + 1 })}
                    aria-label={t('terminal.tab.renameLabel')}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim()
                      setNames((prev) => ({ ...prev, [term.id]: name }))
                      setRenaming(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      else if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  names[term.id] || t('terminal.tab.label', { n: i + 1 })
                )}
                <IconButton
                  size="sm"
                  icon={<Icon name="close" size={14} />}
                  label={t('terminal.tab.close')}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTerminal(term.id)
                  }}
                />
              </span>
            ))}
          </span>
        )}
        {tabMenu && (
          <Menu
            at={tabMenu.at}
            onClose={() => setTabMenu(null)}
            items={[
              { label: t('terminal.tab.rename'), onSelect: () => setRenaming(tabMenu.id) },
              { label: t('terminal.tab.close'), onSelect: () => onCloseTerminal(tabMenu.id) },
              {
                label: t('terminal.tab.closeOthers'),
                disabled: terminals.length < 2,
                onSelect: () => terminals.forEach((x) => x.id !== tabMenu.id && onCloseTerminal(x.id))
              }
            ]}
          />
        )}
        <Toolbar label={t(only === 'run' ? 'shell.panel.output' : 'shell.panel.terminal')} items={only === 'run' ? runTools : terminalTools} className="bottom-toolbar" />
      </div>
      <div className="bottom-bodies">
        {/* runAvailable gates the **mount itself**. Hidden tabs are kept alive with display:none elsewhere
            in this panel (below), but every RunPanel calls run.output for its run on mount, and with no
            project there is no run to ask about. */}
        {runAvailable && (
          <div className="bottom-body run-body" style={{ display: activeTab === 'run' ? 'flex' : 'none' }}>
            <div className="run-main">
              <div className="run-consoles">
                {runs.map((r) => (
                  <div
                    key={r.runId}
                    className="run-console"
                    style={{ display: r.runId === selectedRunId ? 'flex' : 'none' }}
                  >
                    <RunPanel
                      runId={r.runId}
                      clearNonce={clearNonces[r.runId] ?? 0}
                      scrollToEndNonce={scrollNonces[r.runId] ?? 0}
                      findOpen={!!findOpen[r.runId]}
                      onFindOpenChange={(open) => setFindOpen((prev) => ({ ...prev, [r.runId]: open }))}
                      onOpenFile={onOpenFile}
                      onOpenUrl={onOpenUrl}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* Inactive tabs stay mounted with display:none (see the comment above) — as a result, when a
            terminal tab is first mounted while inactive, TerminalBody's initial fit.fit() runs against a
            0×0 host and xterm stays at the default 80×24 (the PTY is 120×30). Output that arrives while
            hidden wraps at that width, but opening the tab makes the ResizeObserver refit and corrects it
            — cosmetic and self-correcting. The same applies to a RunPanel mounted for a tab that is not
            selected. */}
        {terminals.map((term) => (
          <div
            key={term.id}
            className="bottom-body"
            style={{ display: activeTab === term.id ? 'flex' : 'none' }}
          >
            <TerminalBody
              id={term.id}
              initialBuffer={term.buffer}
              clearNonce={clearNonces[term.id] ?? 0}
              active={activeTab === term.id}
              cwd={terminalCwd}
              onOpenUrl={onOpenUrl}
              onOpenFile={onOpenFile}
              onOpenFolder={onOpenFolder}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
