import { useEffect, useRef, useState } from 'react'
import type { Account, HistoryEntry, ProjectSummary, ScheduleConfig, SessionKind, TranscriptPreview } from '../../../core/types'
import { ResumeDialog } from './ResumeDialog'
import { TranscriptPreviewModal } from './TranscriptPreviewModal'
import { isGhostAccountId } from '../../../core/accounts/ghostId'
import { confirmModal } from '../lib/confirm'
import { useI18n } from '../i18n/I18nProvider'
import { EmptyState, ICONS, Icon, IconButton, Menu, Skeleton, Toolbar, Tree, ViewPane, menuPointOf, type MenuItem, type TreeItem } from './ui'
import * as hiddenProjects from '../lib/hiddenProjects'
import { sessionRows, type SessionRow, type SessionSlice } from './views/historyRows'

const PAGE = 50
const SEEN_KEY = 'cm.historySeen'
const SEEN_PRUNE_LIMIT = 500

function loadSeenMap(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/** "Still loading" for this panel — a few skeleton lines where the rows will land. Both lists here are
 *  lists, so the placeholder sits in the place a row would be. The readable name is the status label. */
function LoadingRows({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={`${70 - i * 12}%`} />
      ))}
    </>
  )
}

type ScanState = { active: boolean; done: number; total: number }

/** "Scanning Codex history… N/M" — shown while the codex rollout index reads the heads it does not
 *  know yet (a first start, or many new rollouts). The project list and an expansion both wait on it,
 *  so it sits at the top of the list rather than in one row. Exported for HistoryBrowser.test.ts. */
export function ScanStatus({ scan }: { scan: ScanState | null }): React.JSX.Element | null {
  const { t } = useI18n()
  if (!scan?.active) return null
  return (
    <div className="history-sentinel" role="status">
      {t('history.scan.codex', { done: scan.done, total: scan.total })}
    </div>
  )
}


type OnResume = (
  entry: HistoryEntry,
  cwd: string,
  opts: {
    accountIds: string[]
    roll: boolean
    rollPrompt?: string
    slackNotify: boolean
    bypassPermissions: boolean
    schedule?: ScheduleConfig
  }
) => void

/** The Sessions pane of the History view (DESIGN-W13 §4): a Tree of Project › session. A click on a project folds it, a
 *  click on a session previews its transcript, resuming is the row's hover action and the context menu. */
export function HistoryBrowser({
  accounts,
  ghostAccounts,
  defaultSessionKind,
  onResume
}: {
  accounts: Account[]
  /** Unregistered sources, for display only. Kept apart from `accounts` so nothing here can be picked as
   *  a spawn or rolling target; accountOf() looks through both so dots, badges and the filter keep working. */
  ghostAccounts: Account[]
  /** Passed straight to ResumeDialog — the Settings default the kind picker opens on. */
  defaultSessionKind: SessionKind
  onResume: OnResume
}): React.JSX.Element {
  const { t } = useI18n()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [total, setTotal] = useState(0)
  // Whether the first project page has ever arrived: without it an empty `projects` means both "still loading" and
  // "nothing", and the list said "no history" for the whole first fetch. It never goes back to false — on a filter
  // change or history:updated the previous list stays until the new one lands.
  const [loaded, setLoaded] = useState(false)
  const [accountFilter, setAccountFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [slices, setSlices] = useState<Record<string, SessionSlice>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<TranscriptPreview | null>(null)
  const [resumingId, setResumingId] = useState<string | null>(null)
  // Account picker modal for resuming — opens after a row click has resolved the cwd
  const [pendingResume, setPendingResume] = useState<{ entry: HistoryEntry; cwd: string } | null>(null)
  const [seenMap, setSeenMap] = useState<Record<string, string>>(loadSeenMap)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [hidden, setHidden] = useState<string[]>(() => hiddenProjects.list())
  const [scan, setScan] = useState<ScanState | null>(null)
  const previewReq = useRef<string | null>(null)
  const reqToken = useRef(0)
  const fetchingRef = useRef(false)
  const sessionTokens = useRef<Record<string, number>>({})
  // the Tree reports a selection for the keys as well as the mouse; only a mouse click should fold or preview
  const byMouse = useRef(false)
  // callbacks of the long-lived effects read the latest values from these
  const live = useRef({ projects, slices, expanded, accountFilter, hidden })
  live.current = { projects, slices, expanded, accountFilter, hidden }

  const accountOf = (id: string): Account | undefined => accounts.find((a) => a.id === id) ?? ghostAccounts.find((a) => a.id === id)
  const isSeen = (e: HistoryEntry): boolean => seenMap[e.id] === e.updatedAt

  const markSeen = (e: HistoryEntry): void => {
    setSeenMap((prev) => {
      const next: Record<string, string> = { ...prev, [e.id]: e.updatedAt }
      const keys = Object.keys(next)
      if (keys.length > SEEN_PRUNE_LIMIT) {
        // Only trim the excess — drop the keys added longest ago first (by insertion order)
        for (const k of keys.slice(0, keys.length - SEEN_PRUNE_LIMIT)) delete next[k]
      }
      localStorage.setItem(SEEN_KEY, JSON.stringify(next))
      return next
    })
  }

  /** The window of projects from the top, at least `limit` of them. */
  const loadProjects = (acc: string, limit: number = PAGE): void => {
    const token = ++reqToken.current
    void window.api.history.projectsPage({ accountId: acc || undefined, offset: 0, limit, hiddenPaths: live.current.hidden }).then((p) => {
      if (reqToken.current !== token) return // ignore a late response
      setProjects(p.projects)
      setTotal(p.total)
      setLoaded(true)
    })
  }

  const loadMoreProjects = (): void => {
    if (fetchingRef.current || live.current.projects.length >= total) return
    fetchingRef.current = true
    const token = reqToken.current
    void window.api.history
      .projectsPage({ accountId: live.current.accountFilter || undefined, offset: live.current.projects.length, limit: PAGE, hiddenPaths: live.current.hidden })
      .then((p) => {
        fetchingRef.current = false
        if (reqToken.current !== token) return
        setProjects((prev) => {
          const seen = new Set(prev.map((x) => x.projectPath))
          return [...prev, ...p.projects.filter((x) => !seen.has(x.projectPath))]
        })
        setTotal(p.total)
      })
  }

  /** A project's sessions: the next page (`append`), or the first page again at the size already on screen. */
  const loadSessions = (projectPath: string, append: boolean): void => {
    const token = (sessionTokens.current[projectPath] = (sessionTokens.current[projectPath] ?? 0) + 1)
    const have = live.current.slices[projectPath]?.entries.length ?? 0
    void window.api.history
      .page({
        accountId: live.current.accountFilter || undefined,
        projectPath,
        offset: append ? have : 0,
        limit: append ? PAGE : Math.max(have, PAGE)
      })
      .then((p) => {
        if (sessionTokens.current[projectPath] !== token) return
        setSlices((prev) => {
          const old = append ? (prev[projectPath]?.entries ?? []) : []
          const seen = new Set(old.map((e) => e.id))
          return { ...prev, [projectPath]: { entries: [...old, ...p.entries.filter((e) => !seen.has(e.id))], total: p.total, loaded: true } }
        })
      })
  }

  useEffect(() => {
    loadProjects('')
    return window.api.on('history:updated', () => {
      // Re-query the project window at its current size, and the expanded projects' sessions with it
      loadProjects(live.current.accountFilter, Math.max(live.current.projects.length, PAGE))
      live.current.expanded.forEach((path) => loadSessions(path, false))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => window.api.on('history:scan', (e) => setScan(e.active ? e : null)), [])

  // Hiding (here) and unhiding (the settings modal) both arrive here. Re-fetch from the first page: removing a row
  // shifts every later offset, so a partial refresh would duplicate or drop rows.
  useEffect(
    () =>
      hiddenProjects.subscribe(() => {
        const next = hiddenProjects.list()
        setHidden(next)
        live.current.hidden = next // setState has not committed yet and loadProjects reads this
        // Unhiding a row must not bring it back already expanded
        setExpanded((prev) => {
          const kept = new Set([...prev].filter((p) => !next.includes(p)))
          return kept.size === prev.size ? prev : kept
        })
        loadProjects(live.current.accountFilter, Math.max(live.current.projects.length, PAGE))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const setOpen = (projectPath: string, open: boolean): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(projectPath)
      else next.delete(projectPath)
      return next
    })
    if (open) loadSessions(projectPath, false)
  }

  const closePreview = (): void => {
    previewReq.current = null
    setPreview(null)
  }

  const openPreview = (e: HistoryEntry): void => {
    markSeen(e)
    previewReq.current = e.id
    void window.api.history.preview(e.id).then((p) => {
      if (previewReq.current === e.id) setPreview(p)
    })
  }

  const resume = async (entry: HistoryEntry): Promise<void> => {
    if (resumingId) return
    setResumingId(entry.id)
    markSeen(entry)
    try {
      let cwd = entry.projectPath
      if (!(await window.api.system.pathExists(cwd))) {
        // The cwd is gone → pick a new path. A confirmation modal breaks it up so the folder picker opens only after the explanation has been read
        const ok = await confirmModal({
          title: t('history.resume.folderMissingTitle'),
          body: t('history.resume.folderMissingBody', { cwd }),
          confirmLabel: t('history.resume.pickFolder')
        })
        if (!ok) return
        const picked = await window.api.system.pickFolder()
        if (!picked) return
        cwd = picked
      }
      setPendingResume({ entry, cwd }) // opens the account picker modal — onResume is called once it is confirmed
    } finally {
      setResumingId(null)
    }
  }

  const rows = sessionRows(projects, slices, expanded, projects.length < total)
  const rowById = new Map(rows.map((r) => [r.id, r]))

  const timeOf = (iso: string): string => new Date(iso).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  const itemOf = (r: SessionRow): TreeItem => {
    switch (r.kind) {
      case 'project':
        return { id: r.id, depth: 0, label: r.project.name, icon: <Icon name="folder" />, description: timeOf(r.project.updatedAt), hasChildren: true, expanded: r.expanded }
      case 'session': {
        const e = r.entry
        const account = accountOf(e.accountId)
        return {
          id: r.id,
          depth: 1,
          label: e.title,
          // A ghost gets a hollow dot: its colour is a single grey, so colour alone would not separate it from a
          // registered account that happens to be grey
          icon: <span className={isGhostAccountId(e.accountId) ? 'color-dot ghost' : 'color-dot'} style={{ background: account?.color ?? 'var(--text-faint)' }} />,
          description: `${account?.label ?? ''} ${timeOf(e.updatedAt)}`.trim(),
          decoration: e.awaitingReply && !isSeen(e) ? { icon: <span className="unread-dot" />, text: t('history.entry.unread'), tone: 'info' } : undefined,
          actions: <IconButton size="sm" icon={<Icon name="run" />} label={t('history.entry.resume')} onClick={() => void resume(e)} />
        }
      }
      case 'loading':
        return { id: r.id, depth: 1, label: t('history.loading') }
      case 'empty':
        return { id: r.id, depth: 1, label: t('history.project.noSessions') }
      case 'more':
        return { id: r.id, depth: r.depth, label: t('history.more') }
    }
  }

  // a click (not the keyboard cursor) on a row does what the row is for
  const activate = (r: SessionRow): void => {
    if (r.kind === 'project') setOpen(r.project.projectPath, !r.expanded)
    else if (r.kind === 'session') openPreview(r.entry)
    else if (r.kind === 'more') {
      if (r.projectPath) loadSessions(r.projectPath, true)
      else loadMoreProjects()
    }
  }

  const menuItems = (r: SessionRow | undefined): MenuItem[] => {
    if (r?.kind === 'project') return [{ label: t('history.menu.hide'), onSelect: () => hiddenProjects.hide(r.project.projectPath) }]
    if (r?.kind !== 'session') return []
    const e = r.entry
    return [
      { label: t('history.menu.resume'), icon: <Icon name="run" />, onSelect: () => void resume(e) },
      { label: t('history.menu.preview'), icon: <Icon name="history" />, onSelect: () => openPreview(e) },
      { label: t('history.menu.copyId'), icon: <Icon name="copy" />, onSelect: () => void navigator.clipboard.writeText(e.sessionId).catch(() => undefined) }
    ]
  }

  const filterItems: MenuItem[] = [
    { id: '', label: t('history.filter.allAccounts'), checked: accountFilter === '', onSelect: () => changeFilter('') },
    // Ghosts are filterable too — their sessions are in the list, so the filter has to be able to reach them
    ...[...accounts, ...ghostAccounts].map((a) => ({
      id: a.id,
      label: a.label + (isGhostAccountId(a.id) ? t('history.filter.deletedSuffix') : ''),
      checked: accountFilter === a.id,
      onSelect: () => changeFilter(a.id)
    }))
  ]
  function changeFilter(v: string): void {
    setAccountFilter(v)
    live.current.accountFilter = v
    setExpanded(new Set()) // the filter changes what a project holds: start folded
    setSlices({})
    loadProjects(v)
  }

  const actions = (
    <>
      <Menu
        items={filterItems}
        label={t('history.filter.label')}
        align="end"
        trigger={{ icon: <Icon name="filter" size={16} />, size: 'sm', title: t('history.filter.label') }}
      />
      <Toolbar
        label={t('history.tree.label')}
        items={[{ id: 'refresh', icon: <Icon name="refresh" />, label: t('history.refresh.label'), onClick: () => void window.api.history.refresh() }]}
      />
    </>
  )

  return (
    <ViewPane title={t('shell.history.sessions')} count={loaded && total > 0 ? total : undefined} actions={actions} storageKey="history.sessions">
      <div className="history-body" onMouseDownCapture={() => (byMouse.current = true)} onKeyDownCapture={() => (byMouse.current = false)}>
        <ScanStatus scan={scan} />
        {!loaded ? (
          // Before the first page: skeleton lines where the rows land, so "loading" is not read as "no history"
          <div className="history-loading" role="status" aria-label={t('history.loading')} aria-busy="true">
            <LoadingRows rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ICONS.history} title={t('history.panel.empty')}>
            {t('history.panel.emptyHint')}
          </EmptyState>
        ) : (
          <Tree
            label={t('history.tree.label')}
            rows={rows.map(itemOf)}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              const r = rowById.get(id)
              if (r && byMouse.current) activate(r)
            }}
            onToggle={(id, open) => {
              const r = rowById.get(id)
              if (r?.kind === 'project') setOpen(r.project.projectPath, open)
            }}
            onOpen={(id) => {
              const r = rowById.get(id)
              if (r && !byMouse.current) activate(r) // Enter; a double-click was already handled by its click
            }}
            onContextMenu={(id, e) => {
              e.preventDefault() // not Electron's own menu
              const at = menuPointOf(e)
              setMenu({ ...at, id })
            }}
          />
        )}
      </div>
      {menu && menuItems(rowById.get(menu.id)).length > 0 && (
        <Menu at={{ x: menu.x, y: menu.y }} label={t('history.menu.label')} items={menuItems(rowById.get(menu.id))} onClose={() => setMenu(null)} />
      )}
      {preview && <TranscriptPreviewModal preview={preview} onClose={closePreview} />}
      {pendingResume && (
        <ResumeDialog
          entry={pendingResume.entry}
          cwd={pendingResume.cwd}
          accounts={accounts}
          defaultSessionKind={defaultSessionKind}
          ghostAccounts={ghostAccounts}
          onConfirm={(opts) => {
            onResume(pendingResume.entry, pendingResume.cwd, opts)
            setPendingResume(null)
          }}
          onCancel={() => setPendingResume(null)}
        />
      )}
    </ViewPane>
  )
}
