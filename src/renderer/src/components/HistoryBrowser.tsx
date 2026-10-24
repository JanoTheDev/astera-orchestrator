import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '../../../core/sessions/summary'
import type { Account, HistoryEntry, ProjectSummary, ScheduleConfig, SessionKind, TranscriptPreview } from '../../../core/types'
import { ResumeDialog } from './ResumeDialog'
import { TranscriptPreviewModal } from './TranscriptPreviewModal'
import {
  cachedPage, cachedProjects, mergePage, mergeProjects, pageKey, projectsKey, rememberExpanded, rememberPage, rememberProjects,
  rememberedExpanded
} from './historyCache'
import { accountChipText, scopeProjects, sessionTreeRows, shortModel, type SessionFacts, type SessionPage } from './historyTree'
import { elapsedLabel, modelEffortLabel } from './wall/sessionRow'
import { openPlan } from './shell/navigation'
import { localDoor } from '../lib/orchDoor'
import { useSummaries } from '../state/useSummaries'
import { summaryOneLine } from './wall/summaryText'
import { ViewToolbar } from './shell/SideBar'
import { isGhostAccountId } from '../../../core/accounts/ghostId'
import { confirmModal } from '../lib/confirm'
import { useI18n } from '../i18n/I18nProvider'
import { Badge, Chip, EmptyState, ICONS, Icon, IconButton, Menu, Skeleton, Tree, menuPointOf, type MenuItem, type TreeItem } from './ui'
import * as hiddenProjects from '../lib/hiddenProjects'
import './views/history.css'

const PAGE = 50
/** The project window when scoped: the history API cannot filter by project, so the picked project must be inside
 *  the page. shortcut: a project older than this many is missed, page it server-side if that ever happens. */
const SCOPED_LIMIT = 1000
const ACCOUNT_KEY = 'cm.historyAccount'

function loadAccountFilter(): string {
  try {
    return localStorage.getItem(ACCOUNT_KEY) ?? ''
  } catch {
    return ''
  }
}
/** The projects whose older finished sessions are unfolded (historyTree's "older" row). */
const OLDER_KEY = 'cm.historyOlder'

function loadOlder(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(OLDER_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
const FINISHED: SessionFacts = { status: 'finished' }
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

/** Reads one expanded project's session summaries (W9-I) and hands them up; renders nothing. A hook per project
 *  cannot sit in the browser itself, since the number of expanded projects changes. */
function SummaryFeed({ projectPath, onSummaries }: { projectPath: string; onSummaries: (projectPath: string, bySession: Map<string, SessionSummary>) => void }): null {
  const door = useMemo(() => (typeof window !== 'undefined' ? localDoor(window.api, projectPath) : null), [projectPath])
  const { bySession } = useSummaries(door)
  useEffect(() => {
    onSummaries(projectPath, bySession)
    return () => onSummaries(projectPath, new Map())
  }, [projectPath, bySession, onSummaries])
  return null
}

type ScanState = { active: boolean; done: number; total: number }

/** "Scanning Codex history… N/M" — shown while the codex rollout index reads the heads it does not
 *  know yet (a first start, or many new rollouts). The project list and an expansion both wait on it,
 *  so it sits at the top of the list rather than in one row. Exported for HistoryBrowser.test.ts. */
export function ScanStatus({ scan }: { scan: ScanState | null }): React.JSX.Element | null {
  const { t } = useI18n()
  if (!scan?.active) return null
  return (
    <div className="history-scan" role="status">
      {t('history.scan.codex', { done: scan.done, total: scan.total })}
    </div>
  )
}

export function HistoryBrowser({
  accounts,
  ghostAccounts,
  defaultSessionKind,
  scopeId = null,
  ownerOf = () => null,
  factsOf = () => FINISHED,
  liveIn = () => 0,
  onResume
}: {
  accounts: Account[]
  /** Unregistered sources, for display only. Kept apart from `accounts` so nothing here can be picked as
   *  a spawn or rolling target; accountOf() looks through both so dots, badges and the filter keep working. */
  ghostAccounts: Account[]
  /** Passed straight to ResumeDialog — the Settings default the kind picker opens on. */
  defaultSessionKind: SessionKind
  /** The top switcher's pick: only that project's folders show, expanded. null is "All projects". */
  scopeId?: string | null
  /** The project id a history folder belongs to (projectOfCwd over the workspace tree); needed when `scopeId` is set. */
  ownerOf?: (projectPath: string) => string | null
  /** What the app knows of a transcript's session (historyTree's sessionFactsOf): live state, plan. */
  factsOf?: (transcriptId: string) => SessionFacts
  /** How many sessions run in a project folder now; such projects list first. */
  liveIn?: (projectPath: string) => number
  onResume: (
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
  /** Kept for the compatibility page (shell/Pages.tsx); the tree is the same either way. */
  asPage?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  // A remount starts from what was shown last (historyCache), so the skeleton is only for the very first open.
  const [seed] = useState(() => cachedProjects(projectsKey(loadAccountFilter(), scopeId !== null)))
  const [projects, setProjects] = useState<ProjectSummary[]>(seed?.projects ?? [])
  const [total, setTotal] = useState(seed?.total ?? 0)
  // Whether the first project page has ever arrived. Without it an empty `projects` means two different
  // things — still loading, or genuinely nothing. It never goes back to false: on an account-filter change or
  // history:updated the previous list stays on screen until the new one lands.
  const [loaded, setLoaded] = useState(seed !== undefined)
  const [accountFilter, setAccountFilter] = useState<string>(loadAccountFilter)
  const [expanded, setExpanded] = useState<Set<string>>(rememberedExpanded)
  const [summaries, setSummaries] = useState<Record<string, Map<string, SessionSummary>>>({})
  const setProjectSummaries = useCallback((path: string, m: Map<string, SessionSummary>) => setSummaries((p) => ({ ...p, [path]: m })), [])
  // Each expanded project's sessions. A project with no entry here is still waiting for its first page.
  const [pages, setPages] = useState<Record<string, SessionPage & { entries: HistoryEntry[] }>>(() => {
    const acc = loadAccountFilter()
    const out: Record<string, SessionPage & { entries: HistoryEntry[] }> = {}
    for (const path of rememberedExpanded()) {
      const c = cachedPage(pageKey(acc, path))
      if (c) out[path] = c
    }
    return out
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<TranscriptPreview | null>(null)
  const [resumingId, setResumingId] = useState<string | null>(null)
  // Account picker modal for resuming — opens after a row click has resolved the cwd
  const [pendingResume, setPendingResume] = useState<{
    entry: HistoryEntry
    cwd: string
  } | null>(null)
  const [seenMap, setSeenMap] = useState<Record<string, string>>(loadSeenMap)
  // 우클릭 메뉴는 한 번에 하나만 열려야 하므로 행이 아니라 여기에 둔다 (FileExplorer와 같은 구조)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [hidden, setHidden] = useState<string[]>(() => hiddenProjects.list())
  const [scan, setScan] = useState<ScanState | null>(null)
  const [showOlder, setShowOlder] = useState<Set<string>>(loadOlder)
  // "12m" to the minute
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const previewReq = useRef<string | null>(null)
  const viaPointer = useRef(false)
  const reqToken = useRef(0)
  const fetchingRef = useRef(false)
  const sessionTokens = useRef<Record<string, number>>({})
  const autoExpanded = useRef(new Set<string>())
  const projectsLenRef = useRef(0)
  projectsLenRef.current = projects.length
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const accountFilterRef = useRef(accountFilter)
  accountFilterRef.current = accountFilter
  const scopedRef = useRef(scopeId !== null)
  scopedRef.current = scopeId !== null
  const hiddenRef = useRef<string[]>(hidden)
  hiddenRef.current = hidden
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const pagesRef = useRef(pages)
  pagesRef.current = pages

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

  const loadFirstProjects = (acc: string, limit: number = PAGE): void => {
    const token = ++reqToken.current
    void window.api.history
      .projectsPage({
        accountId: acc || undefined,
        offset: 0,
        limit,
        hiddenPaths: hiddenRef.current
      })
      .then((p) => {
        if (reqToken.current !== token) return // ignore a late response
        rememberProjects(projectsKey(acc, scopedRef.current), p)
        setProjects(p.projects)
        setTotal(p.total)
        setLoaded(true)
      })
  }

  const loadMoreProjects = (): void => {
    if (fetchingRef.current || projects.length >= total) return
    fetchingRef.current = true
    const token = reqToken.current
    void window.api.history
      .projectsPage({
        accountId: accountFilterRef.current || undefined,
        offset: projects.length,
        limit: PAGE,
        hiddenPaths: hiddenRef.current
      })
      .then((p) => {
        fetchingRef.current = false
        if (reqToken.current !== token) return
        const merged = mergeProjects(projectsRef.current, p.projects)
        rememberProjects(projectsKey(accountFilterRef.current, scopedRef.current), { projects: merged, total: p.total })
        setProjects(merged)
        setTotal(p.total)
      })
  }

  /** A project's sessions: its first page again at the window already shown (`append` false), or the next page. */
  const loadSessions = (projectPath: string, append: boolean): void => {
    const acc = accountFilterRef.current
    const have = pagesRef.current[projectPath]?.entries.length ?? 0
    const token = (sessionTokens.current[projectPath] = (sessionTokens.current[projectPath] ?? 0) + 1)
    void window.api.history
      .page({
        accountId: accountFilterRef.current || undefined,
        projectPath,
        offset: append ? have : 0,
        limit: append ? PAGE : Math.max(have, PAGE)
      })
      .then((p) => {
        if (sessionTokens.current[projectPath] !== token) return // the window was swapped out in the meantime — ignore
        setPages((prev) => {
          const next = { entries: mergePage(append ? (prev[projectPath]?.entries ?? []) : [], p.entries), total: p.total }
          rememberPage(pageKey(acc, projectPath), next)
          return { ...prev, [projectPath]: next }
        })
      })
  }

  // the window and the scope change together: a pick (or "All projects") refetches at the size the scope needs,
  // and the auto-expansion starts over
  useEffect(() => {
    autoExpanded.current = new Set()
    // a window the user had paged down to is refetched at its size, not cut back to the first page
    loadFirstProjects(accountFilterRef.current, scopeId === null ? Math.max(projectsLenRef.current, PAGE) : SCOPED_LIMIT)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId])

  // a picked project's folders open by themselves, once each, so a collapse by hand sticks
  const shownProjects = scopeProjects(projects, scopeId, ownerOf)
  const scopedKey = scopeId === null ? '' : shownProjects.map((p) => p.projectPath).join('\n')
  useEffect(() => {
    if (!scopedKey) return
    for (const path of scopedKey.split('\n')) {
      if (autoExpanded.current.has(path)) continue
      autoExpanded.current.add(path)
      setExpanded((prev) => new Set(prev).add(path))
      loadSessions(path, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedKey])

  useEffect(() => {
    return window.api.on('history:updated', () => {
      // Re-query the project window at its current size, and the expanded projects' sessions with it
      const token = ++reqToken.current
      void window.api.history
        .projectsPage({
          accountId: accountFilterRef.current || undefined,
          offset: 0,
          limit: Math.max(projectsLenRef.current, PAGE),
          hiddenPaths: hiddenRef.current
        })
        .then((p) => {
          if (reqToken.current !== token) return
          rememberProjects(projectsKey(accountFilterRef.current, scopedRef.current), p)
          setProjects(p.projects)
          setTotal(p.total)
          // Also settles the first load, not just a refresh of it: a transcript written while the mount
          // fetch is still in flight bumps reqToken here, which makes that fetch's own .then bail out.
          setLoaded(true)
        })
      for (const path of expandedRef.current) loadSessions(path, false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the projects that came back expanded show their cached sessions now; this asks for fresh ones
  useEffect(() => {
    for (const path of expandedRef.current) if (!autoExpanded.current.has(path)) loadSessions(path, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => rememberExpanded(expanded), [expanded])

  useEffect(() => window.api.on('history:scan', (e) => setScan(e.active ? e : null)), [])

  // 숨기기(이 화면)와 해제(설정 모달) 양쪽에서 들어온다. offset을 유지한 부분 갱신이 아니라 첫
  // 페이지부터 다시 받는다 — 목록에서 항목이 빠지면 그 뒤 offset이 전부 밀려 중복이나 누락이 생긴다
  useEffect(
    () =>
      hiddenProjects.subscribe(() => {
        const next = hiddenProjects.list()
        setHidden(next)
        hiddenRef.current = next // setState는 아직 커밋되지 않았고 아래 호출이 ref를 읽는다
        setExpanded((prev) => {
          const nextSet = new Set([...prev].filter((p) => !next.includes(p)))
          return nextSet.size === prev.size ? prev : nextSet
        })
        // the loaded window's size, not PAGE: one row leaving a long scrolled list must not drop the rest
        loadFirstProjects(accountFilterRef.current, Math.max(projectsLenRef.current, PAGE))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const toggle = (projectPath: string, open: boolean): void => {
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

  const toggleOlder = (projectPath: string): void =>
    setShowOlder((prev) => {
      const next = new Set(prev)
      if (!next.delete(projectPath)) next.add(projectPath)
      try {
        localStorage.setItem(OLDER_KEY, JSON.stringify([...next]))
      } catch {
        /* the fold just does not persist */
      }
      return next
    })

  const treeRows = sessionTreeRows(shownProjects, expanded, (path) => pages[path], scopeId === null && projects.length < total, {
    liveIn,
    statusOf: (e) => factsOf(e.sessionId).status,
    showOlder
  })
  const byId = new Map(treeRows.map((r) => [r.id, r]))

  const summaryLines = new Map<string, string>()
  for (const m of Object.values(summaries)) for (const [id, sum] of m) summaryLines.set(id, summaryOneLine(sum, t))

  // one account picked, or only one there: every row would carry the same chip
  const showAccount = !accountFilter && accounts.length + ghostAccounts.length > 1
  const timeOf = (iso: string, key: 'history.session.lastActive' | null): React.ReactNode => (
    <time dateTime={iso} title={key ? t(key, { when: new Date(iso).toLocaleString() }) : new Date(iso).toLocaleString()}>
      {elapsedLabel(Date.parse(iso), nowMs)}
    </time>
  )

  const items: TreeItem[] = treeRows.map((r): TreeItem => {
    switch (r.kind) {
      case 'project':
        return {
          id: r.id,
          depth: 0,
          label: r.project.name,
          title: `${r.project.projectPath} · ${new Date(r.project.updatedAt).toLocaleString()}`,
          icon: <Icon name="folder" size={16} />,
          hasChildren: true,
          expanded: r.expanded,
          badge: (
            <span className="history-row__facts">
              {r.live > 0 && (
                <span title={t('history.project.live', { n: r.live })}>
                  <Badge tone="info">{r.live}</Badge>
                </span>
              )}
              {timeOf(r.project.updatedAt, null)}
            </span>
          )
        }
      case 'session': {
        const e = r.entry
        const facts = factsOf(e.sessionId)
        const account = accountOf(e.accountId)
        const accountLabel = account ? account.label + (isGhostAccountId(e.accountId) ? t('history.filter.deletedSuffix') : '') : ''
        const word = t(`history.status.${r.status}`)
        const model = modelEffortLabel(shortModel(e.model), e.effort)
        const summary = summaryLines.get(e.sessionId)
        return {
          id: r.id,
          depth: 1,
          label: e.title,
          // the summary one-liner and the account's full name live here, so the row itself stays one quiet line
          title: [e.title, facts.planName, summary, accountLabel, e.model].filter(Boolean).join(' — '),
          icon: <span className={`history-dot history-dot--${r.status}`} role="img" aria-label={word} title={word} />,
          description: facts.planName ?? '',
          badge: (
            <span className="history-row__facts">
              {e.awaitingReply && !isSeen(e) && <span className="unread-dot" role="img" aria-label={t('history.entry.unread')} title={t('history.entry.unread')} />}
              {showAccount && accountLabel && (
                <span title={accountLabel}>
                  <Chip className="history-row__account">{accountChipText(accountLabel)}</Chip>
                </span>
              )}
              {model && <span className="history-row__model">{model}</span>}
              {timeOf(e.updatedAt, 'history.session.lastActive')}
            </span>
          ),
          actions: (
            <>
              <IconButton size="sm" icon={<Icon name="run" size={14} />} label={t('history.entry.resume')} onClick={() => void resume(e)} />
              <IconButton size="sm" icon={<Icon name="show" size={14} />} label={t('history.entry.preview')} onClick={() => openPreview(e)} />
              {facts.jobId && <IconButton size="sm" icon={<Icon name="listTree" size={14} />} label={t('agents.row.plan')} onClick={() => openPlan(facts.jobId!)} />}
            </>
          )
        }
      }
      case 'older':
        return { id: r.id, depth: 1, label: r.open ? t('history.session.fewer') : t('history.session.older', { n: r.count }), icon: <Icon name="more" size={16} /> }
      case 'loading':
        return {
          id: r.id,
          depth: 1,
          label: t('history.loading'),
          icon: <Icon name="loading" size={16} />
        }
      case 'empty':
        return { id: r.id, depth: 1, label: t('history.project.noSessions') }
      case 'more':
        // a button that loads the next page when chosen: it said "Loading…" while nothing loaded
        return {
          id: r.id,
          depth: r.projectPath ? 1 : 0,
          label: t('history.more'),
          icon: <Icon name="more" size={16} />
        }
    }
  })

  const activate = (id: string): void => {
    const r = byId.get(id)
    if (!r) return
    if (r.kind === 'session') openPreview(r.entry)
    else if (r.kind === 'project') toggle(r.project.projectPath, !r.expanded)
    else if (r.kind === 'older') toggleOlder(r.projectPath)
    else if (r.kind === 'more') {
      if (r.projectPath) loadSessions(r.projectPath, true)
      else loadMoreProjects()
    }
  }

  const menuRow = menu ? byId.get(menu.id) : undefined
  const menuItems = (): Array<MenuItem | 'separator'> => {
    if (menuRow?.kind === 'project')
      return [
        {
          id: 'hide',
          label: t('history.menu.hide'),
          icon: <Icon name="hide" size={14} />,
          onSelect: () => hiddenProjects.hide(menuRow.project.projectPath)
        }
      ]
    if (menuRow?.kind !== 'session') return []
    const e = menuRow.entry
    const jobId = factsOf(e.sessionId).jobId
    return [
      {
        id: 'resume',
        label: t('history.entry.resume'),
        icon: <Icon name="run" size={14} />,
        onSelect: () => void resume(e)
      },
      {
        id: 'preview',
        label: t('history.entry.preview'),
        icon: <Icon name="show" size={14} />,
        onSelect: () => openPreview(e)
      },
      {
        id: 'copy',
        label: t('history.entry.copyId'),
        icon: <Icon name="copy" size={14} />,
        onSelect: () => void navigator.clipboard.writeText(e.id)
      },
      ...(jobId ? [{ id: 'plan', label: t('agents.row.plan'), icon: <Icon name="listTree" size={14} />, onSelect: () => openPlan(jobId) }] : [])
    ]
  }

  const filterAccounts = [...accounts, ...ghostAccounts]
  const filterLabel = accountFilter ? (accountOf(accountFilter)?.label ?? accountFilter) : t('history.filter.allAccounts')
  const filterItems: Array<MenuItem | 'separator'> = [
    {
      id: '',
      label: t('history.filter.allAccounts'),
      checked: accountFilter === '',
      onSelect: () => pickAccount('')
    },
    ...filterAccounts.map((a) => ({
      id: a.id,
      // Ghosts are filterable too — their sessions are in the list; the suffix marks them instead of rewriting the label
      label: a.label + (isGhostAccountId(a.id) ? t('history.filter.deletedSuffix') : ''),
      checked: accountFilter === a.id,
      onSelect: () => pickAccount(a.id)
    }))
  ]
  function pickAccount(id: string): void {
    setAccountFilter(id)
    accountFilterRef.current = id
    try {
      localStorage.setItem(ACCOUNT_KEY, id)
    } catch {
      /* the filter just does not persist */
    }
    setExpanded(new Set()) // reset the expansion when the filter changes
    setPages({})
    const cached = cachedProjects(projectsKey(id, scopeId !== null))
    if (cached) {
      setProjects(cached.projects)
      setTotal(cached.total)
    }
    autoExpanded.current = new Set() // a scoped project opens again once its list arrives
    loadFirstProjects(id, scopeId === null ? PAGE : SCOPED_LIMIT)
  }

  return (
    <section className="history-panel">
      <ViewToolbar
        label={t('shell.activity.history')}
        items={[
          {
            id: 'refresh',
            icon: <Icon name="refresh" />,
            label: t('history.refresh.tooltip'),
            onClick: () => void window.api.history.refresh()
          }
        ]}
      />
      <div className="history-filter">
        <Menu
          label={t('history.view.accountFilter')}
          align="start"
          items={filterItems}
          trigger={{
            variant: 'ghost',
            size: 'sm',
            icon: <Icon name="filter" size={14} />,
            children: filterLabel
          }}
        />
      </div>
      {[...expanded].map((path) => (
        <SummaryFeed key={path} projectPath={path} onSummaries={setProjectSummaries} />
      ))}
      <ScanStatus scan={scan} />
      {/* 첫 페이지가 오기 전에는 점 셋, 도착한 뒤에 비어 있으면 '기록 없음'. 두 상태를 가르지 않으면
          프로젝트 디렉터리를 훑는 동안 계속 '기록 없음'이 보인다 */}
      {!loaded && (
        <div className="history-loading" role="status" aria-label={t('history.loading')} aria-busy="true">
          <LoadingRows rows={5} />
        </div>
      )}
      {loaded && shownProjects.length === 0 && (
        <div className="history-empty">
          <EmptyState icon={ICONS.history} title={t('history.panel.empty')}>
            {t('history.panel.emptyHint')}
          </EmptyState>
        </div>
      )}
      {shownProjects.length > 0 && (
        // The tree's selection follows the keyboard cursor, so only a pointer press may open a preview;
        // Enter opens through onOpen below.
        <div className="history-tree" onPointerDownCapture={() => (viaPointer.current = true)} onKeyDownCapture={() => (viaPointer.current = false)}>
          <Tree
            label={t('shell.history.sessions')}
            className="history-sessions"
            rows={items}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              // a click on a row does its one thing: preview a session, fold a project, fetch a page
              if (viaPointer.current) activate(id)
            }}
            onToggle={(id, open) => {
              const r = byId.get(id)
              if (r?.kind === 'project') toggle(r.project.projectPath, open)
            }}
            onOpen={activate}
            onContextMenu={(id, e) => {
              e.preventDefault() // Electron의 기본 메뉴를 막고 앱 메뉴를 띄운다
              const at = menuPointOf(e)
              setMenu({ id, ...at })
            }}
          />
        </div>
      )}
      {menu && menuItems().length > 0 && (
        <Menu
          at={{ x: menu.x, y: menu.y }}
          label={t(menuRow?.kind === 'project' ? 'history.menu.label' : 'history.session.menu')}
          items={menuItems()}
          onClose={() => setMenu(null)}
        />
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
    </section>
  )
}
