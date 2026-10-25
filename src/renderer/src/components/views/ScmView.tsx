// The Source Control side bar view (DESIGN-W13 §4): the Worktrees pane (one row per worktree, the ones git could not
// vouch for last) and the Changes pane (the selected worktree's changed files). A click on a worktree opens its own
// `view:worktree` tab, where its detail, commits and actions are; a click on a changed file shows that file's diff.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangedFile } from '../../../../core/git/changedFile'
import type { WorktreeStatus } from '../../../../core/types'
import { resolveFileIcon } from '../../../../core/files/icons'
import { isMac } from '../../lib/platformKeys'
import { toast } from '../../lib/toast'
import { setCached, useCachedRead } from '../../lib/readCache'
import { repoInScope } from '../../state/projectView'
import { FileIcon } from '../FileIcon'
import { PrBadge } from '../PrBadge'
import { PushBadge } from '../PushBadge'
import { rowSlot } from '../rowSlot'
import { EmptyState, ICONS, Icon, Input, Menu, Tree, ViewContainer, ViewPane, menuPointOf, type MenuItem, type ToolbarItem, Toolbar, type TreeItem } from '../ui'
import { changeLetter } from '../explorerChanged'
import { absoluteOf, changedFileLabels, changedFileMenu } from '../changedFileMenu'
import { DiffView } from '../DiffView'
import { openFile, openWorktree } from '../shell/navigation'
import type { SideBarViewProps } from '../shell/SideBar'
import { AheadBehind } from '../worktrees/WorktreeDetail'
import { useWorktreeDetail } from '../worktrees/useWorktreeDetail'
import { useWorktrees } from '../worktrees/useWorktrees'
import { filterWorktrees, rowState, selectWorktree, useWorktreeView, worktreeEntries } from '../worktrees/worktreeView'

const STATUS_LABEL: Record<Exclude<WorktreeStatus, 'ok'>, 'worktree.status.orphanDir' | 'worktree.status.unreachable' | 'worktree.status.gitUnchecked'> = {
  'orphan-dir': 'worktree.status.orphanDir',
  unreachable: 'worktree.status.unreachable',
  'git-unchecked': 'worktree.status.gitUnchecked'
}

type Diff = { fileId: string } & ({ state: 'loading' } | { state: 'shown'; diff: string; truncated: boolean } | { state: 'failed' })

/** A click opens the tab; the arrow keys only move the selection (Enter opens), as in VSCode's lists. */
function useClickOpen(open: (id: string) => void): { handlers: React.HTMLAttributes<HTMLDivElement>; onSelect: (id: string) => void } {
  const viaKey = useRef(false)
  return {
    handlers: {
      onKeyDownCapture: () => {
        viaKey.current = true
      },
      onPointerDownCapture: () => {
        viaKey.current = false
      }
    },
    onSelect: (id) => {
      if (!viaKey.current) open(id)
    }
  }
}

export function ScmView(p: SideBarViewProps): React.JSX.Element {
  const { t, workspaceTree, scopeId } = p
  const { selected } = useWorktreeView()
  const repoFilter = useCallback((repo: string) => repoInScope(workspaceTree, scopeId, repo), [workspaceTree, scopeId])
  const wt = useWorktrees(repoFilter)
  const [query, setQuery] = useState('')
  const [reachableOnly, setReachableOnly] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const cachedAutoClean = useCachedRead('scm:autoClean', () => window.api.settings.getAutoCleanWorktrees()).data
  const [autoCleanEdit, setAutoClean] = useState<boolean | null>(null)
  const autoClean = autoCleanEdit ?? cachedAutoClean ?? true
  const toggleAutoClean = (next: boolean): void => {
    setAutoClean(next)
    void window.api.settings.setAutoCleanWorktrees(next).then(() => setCached('scm:autoClean', next)).catch((err) => {
      setAutoClean(!next)
      toast.error(t('worktrees.autoCleanFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  const startSession = (path: string): void => {
    p.setNewSessionCwd(path)
    p.setShowNew(true)
  }
  const rows = wt.rows ?? []
  const entries = worktreeEntries(filterWorktrees(rows, query, reachableOnly))
  const byPath = (path: string | null) => rows.find((r) => r.item.path === path)
  const row = byPath(selected)

  const items: TreeItem[] = entries.map(({ row: r, trouble }) => {
    const w = r.item
    const state = wt.removingId === w.id ? null : rowState(r)
    const snap = wt.prs[w.repoPath]
    const slot = rowSlot(snap?.byBranch[w.branch], wt.pushStateOf(w))
    const plan = r.owner ? [r.owner.plan, r.owner.taskTitles.join(', ')].filter(Boolean).join(' › ') : ''
    return {
      id: w.path,
      depth: 0,
      label: w.branch,
      title: `${w.path}\n${w.branch}`,
      icon: <Icon name="branch" size={16} />,
      description: plan,
      badge: (
        // the badges are buttons of their own: a click on them is not a click on the row
        <span className="scm-badges" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <AheadBehind ahead={r.ahead} behind={r.behind} />
          {slot?.kind === 'pr' && <PrBadge pr={slot.pr} stale={snap!.stale} onOpenMenu={(e) => wt.openPrMenu(menuPointOf(e), slot.pr.url)} />}
          {slot?.kind === 'push' && <PushBadge ahead={slot.ahead} base={w.baseRef} disabled={wt.busy || !wt.ghConnected} onCreate={() => wt.createPr(w)} />}
        </span>
      ),
      decoration:
        trouble !== null
          ? { icon: <Icon name="warning" size={14} />, text: t(STATUS_LABEL[trouble]), tone: 'warn' }
          : state === 'active'
            ? { icon: <Icon name="activity" size={14} />, text: t('worktrees.state.active'), tone: 'ok' }
            : state === 'merged'
              ? { icon: <Icon name="merge" size={14} />, text: t('worktrees.state.merged'), tone: 'info' }
              : undefined
    }
  })

  const tree = useClickOpen(openWorktree)
  const detail = useWorktreeDetail(row)
  const files = detail?.files ?? null
  const [diff, setDiff] = useState<Diff | null>(null)
  const [fileMenu, setFileMenu] = useState<{ at: { x: number; y: number }; file: ChangedFile; root: string } | null>(null)
  useEffect(() => setDiff(null), [selected])
  // A click shows the file's diff, read as the Explorer's Changed pane reads it (worktrees.fileDiff by the file's id)
  const showDiff = (fileId: string): void => {
    if (!row) return
    if (diff?.fileId === fileId) return setDiff(null)
    setDiff({ fileId, state: 'loading' })
    void window.api.worktrees.fileDiff(row.item.id, fileId).then(
      (d) => setDiff((cur) => (cur?.fileId !== fileId ? cur : d ? { fileId, state: 'shown', ...d } : { fileId, state: 'failed' })),
      () => setDiff((cur) => (cur?.fileId !== fileId ? cur : { fileId, state: 'failed' }))
    )
  }
  const fileTree = useClickOpen(showDiff)
  const shownFile = files?.find((f) => f.id === diff?.fileId)
  const changeItems: TreeItem[] = (files ?? []).map((f) => {
    const cut = f.path.lastIndexOf('/')
    const word = t(`jobs.changes.status.${f.status}` as never)
    return {
      id: f.id,
      depth: 0,
      label: f.path.slice(cut + 1),
      title: `${f.path}\n${word}`,
      icon: <FileIcon {...resolveFileIcon(f.path.slice(cut + 1))} />,
      description: cut < 0 ? undefined : f.path.slice(0, cut),
      decoration: { text: changeLetter(f.status), tone: f.status === 'added' ? 'ok' : f.status === 'deleted' ? 'danger' : f.status === 'renamed' ? 'info' : 'warn' }
    }
  })

  const toolbar: ToolbarItem[] = [
    { id: 'refresh', icon: <Icon name="refresh" size={16} />, label: t('worktree.refresh'), disabled: wt.busy || wt.cleaning, onClick: () => void wt.refresh() },
    { id: 'reachable', icon: <Icon name="filter" size={16} />, label: t('worktrees.reachableOnly'), active: reachableOnly, onClick: () => setReachableOnly((v) => !v) },
    { id: 'help', icon: <Icon name="info" size={16} />, label: t('worktrees.helpLabel'), onClick: () => toast.info(t('worktrees.hint')) }
  ]
  if (wt.ready.length > 0)
    toolbar.push({ id: 'cleanup', icon: <Icon name="sparkles" size={16} />, label: t('worktrees.cleanup.button', { count: wt.ready.length }), disabled: wt.busy || wt.cleaning, onClick: () => void wt.cleanUp() })

  const menuItems = (path: string): Array<MenuItem | 'separator'> => {
    const r = byPath(path)
    if (!r) return []
    const w = r.item
    const pr = wt.prs[w.repoPath]?.byBranch[w.branch]
    const ahead = wt.pushStateOf(w)?.ahead
    const out: Array<MenuItem | 'separator'> = [
      { label: t('worktrees.detail.openHere'), disabled: w.status !== 'ok', onSelect: () => startSession(w.path) },
      { label: t('worktrees.menu.openExplorer'), disabled: w.status !== 'ok', onSelect: () => p.openLinkedFolder(w.path) },
      'separator'
    ]
    if (pr) {
      out.push(
        { label: t('github.badge.openInBrowser'), onSelect: () => void window.api.system.openExternal(pr.url) },
        {
          label: t('github.badge.copyLink'),
          onSelect: () => {
            window.api.clipboard.writeText(pr.url)
            toast.success(t('github.badge.linkCopied'))
          }
        }
      )
    }
    // A closed or merged PR keeps its badge, but the branch can be proposed again; a merged branch is usually ahead === 0,
    // which the disabled rule keeps quiet. A disabled item states its reason in its own label (no hint field).
    if (!pr || pr.state !== 'open')
      out.push({
        label: ahead === 0 ? t('worktree.push.noCommits') : !wt.ghConnected ? t('worktree.push.ghDisconnected') : t('worktree.push.createPr'),
        disabled: ahead === 0 || !wt.ghConnected || wt.busy,
        onSelect: () => wt.createPr(w)
      })
    out.push('separator', { label: t('files.action.delete'), disabled: wt.busy, onSelect: () => void wt.remove(w) })
    return out
  }

  const body = (): React.ReactNode => {
    if (wt.failed !== null && rows.length === 0)
      return (
        <EmptyState icon={ICONS.warning} title={t('worktrees.title')}>
          {wt.failed}
        </EmptyState>
      )
    if (wt.rows === null) return null
    if (rows.length === 0)
      return (
        <EmptyState icon={ICONS.repo} title={t('worktrees.emptyTitle')}>
          {t('worktrees.empty')}
        </EmptyState>
      )
    return (
      <>
        {wt.refreshing && <p className="wb-view-empty" role="status">{t('worktrees.refreshing')}</p>}
        <div className="scm-filter">
          <Input type="search" placeholder={t('worktrees.search')} aria-label={t('worktrees.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {entries.length === 0 ? (
          <p className="wb-view-empty">{t('worktrees.noMatch')}</p>
        ) : (
          <div className="scm-tree" {...tree.handlers}>
            <Tree
              rows={items}
              selectedId={selected}
              label={t('worktrees.title')}
              onSelect={(id) => {
                selectWorktree(id)
                tree.onSelect(id)
              }}
              onOpen={openWorktree}
              onContextMenu={(id, e) => setMenu({ ...menuPointOf(e), path: id })}
            />
          </div>
        )}
      </>
    )
  }

  return (
    <div className="wb-view wb-view--scm">
      <ViewContainer label={t('shell.activity.scm')}>
        <ViewPane
          title={t('worktrees.title')}
          count={rows.length > 0 ? rows.length : undefined}
          storageKey="scm.worktrees"
          actions={
            <Toolbar
              label={t('worktrees.title')}
              items={toolbar}
              overflowLabel={t('worktrees.viewOptions')}
              overflow={[
                {
                  id: 'auto-clean',
                  checked: autoClean,
                  label: (
                    <span className="worktrees-option">
                      {t('worktrees.autoClean')}
                      <span className="worktrees-option__hint">{t('worktrees.autoCleanHint')}</span>
                    </span>
                  ),
                  onSelect: () => toggleAutoClean(!autoClean)
                }
              ]}
            />
          }
        >
          {body()}
        </ViewPane>
        <ViewPane title={t('worktrees.changesPane')} count={files && files.length > 0 ? files.length : undefined} storageKey="scm.changes" className="scm-changes">
          {row === undefined ? (
            <p className="wb-view-empty">{t('worktrees.changesPick')}</p>
          ) : detail === undefined ? (
            <p className="wb-view-empty">{t('files.editor.loading')}</p>
          ) : files === null ? (
            <p className="wb-view-empty">{t('worktrees.changes.unavailable')}</p>
          ) : files.length === 0 ? (
            <p className="wb-view-empty">{t('worktrees.changes.none')}</p>
          ) : (
            <div className="scm-tree" {...fileTree.handlers}>
              <Tree
                rows={changeItems}
                label={t('worktrees.changesPane')}
                onSelect={fileTree.onSelect}
                onOpen={() => openWorktree(row.item.path)}
                onContextMenu={(id, e) => {
                  const file = files?.find((f) => f.id === id)
                  if (file) setFileMenu({ at: menuPointOf(e), file, root: row.item.path })
                }}
              />
            </div>
          )}
          {diff?.state === 'shown' && <DiffView diff={diff.diff} truncated={diff.truncated} binary={shownFile?.binary === true} />}
          {diff?.state === 'failed' && <p className="wb-view-empty">{t('worktrees.changes.unavailable')}</p>}
        </ViewPane>
      </ViewContainer>
      {wt.overlays}
      {menu && <Menu at={menu} label={t('worktrees.rowMenu')} items={menuItems(menu.path)} onClose={() => setMenu(null)} />}
      {fileMenu && (
        <Menu
          at={fileMenu.at}
          items={changedFileMenu(
            { status: fileMenu.file.status, path: absoluteOf(fileMenu.root, fileMenu.file.path), relative: fileMenu.file.path },
            changedFileLabels(t, isMac()),
            {
              open: openFile,
              diff: () => showDiff(fileMenu.file.id),
              copy: (text) => window.api.clipboard.writeText(text),
              reveal: (path) =>
                void window.api.files.reveal(path).catch((err: unknown) => toast.error(t('explorer.reveal.failed', { detail: err instanceof Error ? err.message : String(err) })))
            }
          )}
          onClose={() => setFileMenu(null)}
        />
      )}
    </div>
  )
}
