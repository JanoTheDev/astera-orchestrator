import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import type { BranchPushState, WorktreeListItem } from '../../../core/types'
import { groupWorktrees, type WorktreeRow } from '../../../core/worktrees/cleanup'
import type { MessageKey } from '../../../core/i18n'
import type { RepoPrSnapshot } from '../../../core/github/types'
import { confirmModal } from '../lib/confirm'
import { toast } from '../lib/toast'
import { dirtyCount, isOrphanUnverifiable, worktreeErrorMessage } from '../lib/worktreeErrors'
import { subscribeCreated } from '../lib/worktreeBus'
import { useI18n } from '../i18n/I18nProvider'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { CreatePrDialog } from './CreatePrDialog'
import { PrBadge } from './PrBadge'
import { PushBadge } from './PushBadge'
import { rowSlot } from './rowSlot'
import { Activity, FolderGit2, GitMerge, Play, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { Button, Chip, EmptyState, Icon, IconButton, Input, PageHeader } from './ui'
import { AheadBehind } from './worktrees/WorktreeDetail'
import { filterWorktrees, rowState } from './worktrees/worktreeView'

/** 상태 라벨. **'폴더 없음' 은 없다** — 폴더가 사라졌다고 확인된 항목은 listWithStatus 가 목록을
 *  만들면서 레지스트리에서 걷으므로 이 자리에 도달하지 않는다. 그 줄은 눌러도 할 일이 없는 정보였고,
 *  예약 작업이 워크트리를 쌓으면서 스물일곱 개까지 늘어 하나씩 지워야 했다. '닿을 수 없음' 은 다르다 —
 *  멈춘 네트워크 드라이브처럼 확인이 확답을 주지 못한 항목이라 잊지 않고 그렇게 보여 준다. */
const STATUS_LABEL: Record<Exclude<WorktreeListItem['status'], 'ok'>, MessageKey> = {
  'orphan-dir': 'worktree.status.orphanDir',
  unreachable: 'worktree.status.unreachable',
  // git 이 목록을 주지 못했다 — 'git 등록 소실' 로 보이면 사람이 지워도 되는 잔해로 읽는다
  'git-unchecked': 'worktree.status.gitUnchecked'
}
/** The one sentence under a status group's heading (W11: said once per group, not on every row). */
const TROUBLE_HINT: Record<Exclude<WorktreeListItem['status'], 'ok'>, MessageKey> = {
  'orphan-dir': 'worktrees.trouble.orphanDir',
  unreachable: 'worktrees.trouble.unreachable',
  'git-unchecked': 'worktrees.trouble.gitUnchecked'
}

/** What the Worktrees page can ask of the list (W9-J): the actions its detail header shares with the rows. */
export interface WorktreeListHandle {
  remove(w: WorktreeListItem): Promise<void>
  createPr(w: WorktreeListItem): void
  refresh(): Promise<void>
  pushStateOf(w: WorktreeListItem): BranchPushState | undefined
}

/** The Worktrees page's header and left list (W9-J, W11 §9): the worktrees this app created (per the registry), grouped
 *  per plan, "Ready to clean up" and "Yours", with the rows git could not vouch for grouped at the bottom. The refresh, the PR/push badges and the remove flow with its confirmations are the
 *  sidebar panel's, unchanged. */
export const WorktreePanel = forwardRef<
  WorktreeListHandle,
  {
    selected: string | null
    onSelect: (path: string) => void
    onStartSession: (path: string) => void
    /** The rows as last read, for the detail beside the list. */
    onRows?: (rows: WorktreeRow[]) => void
    /** Keeps only the worktrees of these repos (the open project's); every repo when absent. */
    repoFilter?: (repoPath: string) => boolean
    /** The page's own header actions after Clean up and Refresh (view options, close). */
    actions?: React.ReactNode
    /** The detail pane, drawn right of the list. */
    children?: React.ReactNode
  }
>(function WorktreePanel({ selected, onSelect, onStartSession, onRows, repoFilter, actions, children }, handle): React.JSX.Element | null {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [reachableOnly, setReachableOnly] = useState(false)
  // Null until the first list arrives: before it (or when it failed) nothing is known, and "No worktrees yet" would be a lie
  const [read, setRows] = useState<WorktreeRow[] | null>(null)
  // Why the last refresh failed, shown in place of the list until one succeeds: a toast alone leaves an empty page
  const [failed, setFailed] = useState<string | null>(null)
  const rows = read ?? []
  const items = rows.map((r) => r.item)
  const [cleaning, setCleaning] = useState(false)
  const [prs, setPrs] = useState<Record<string, RepoPrSnapshot>>({})
  // PR link menu — one at a time, held here rather than per row (the FileExplorer/HistoryBrowser shape)
  const [prMenu, setPrMenu] = useState<{ x: number; y: number; url: string } | null>(null)
  const [pushState, setPushState] = useState<
    Record<string, Record<string, Record<string, BranchPushState>>>
  >({})
  // The row whose create dialog is open, if any
  const [creating, setCreating] = useState<WorktreeListItem | null>(null)
  // The row menu — one at a time, held here rather than per row (the HistoryBrowser shape)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; w: WorktreeListItem } | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null) // the worktree whose removal is in progress
  // Optimistic, so the panel does not flash a disabled affordance before the cached probe answers.
  const [ghConnected, setGhConnected] = useState(true)
  const busy = removingId !== null

  // PR snapshots: pull once, then ride the push events. Subscribed only while this panel is
  // mounted AND expanded — the zero-subscriber signal is what lets main stop polling (§4).
  useEffect(() => {
    window.api.github.subscribe()
    void window.api.github.prs().then(setPrs)
    // status() answers from the cached probe and never runs gh, so asking here costs nothing
    void window.api.github.status().then((p) => setGhConnected(p.kind === 'connected'))
    const offPrs = window.api.on('github:prs-updated', (p) =>
      setPrs((prev) => ({ ...prev, [p.repoRoot]: p.snapshot }))
    )
    const offStatus = window.api.on('github:status', (probe) => {
      // Badges disappear quietly on disconnect; the settings card explains why (§7)
      setGhConnected(probe.kind === 'connected')
      if (probe.kind !== 'connected') setPrs({})
    })
    return () => {
      offPrs()
      offStatus()
      window.api.github.unsubscribe()
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await window.api.worktrees.overview()
      const overview = repoFilter ? all.filter((r) => repoFilter(r.item.repoPath)) : all
      setRows(overview)
      setFailed(null)
      onRows?.(overview)
      const list = overview.map((r) => r.item)
      // The same triggers that re-query worktrees re-query their PRs: mount, expand, manual ⟳,
      // and the created event. This is the whole manual path when polling is off.
      void window.api.github.refresh({ force: true })
      // Push state is local git, so it rides the same triggers as the list itself rather than a
      // timer: mount, expand, manual refresh, and the worktree-created event.
      const byRepo = new Map<string, Set<string>>()
      for (const w of list) byRepo.set(w.repoPath, (byRepo.get(w.repoPath) ?? new Set()).add(w.baseRef))
      const next: Record<string, Record<string, Record<string, BranchPushState>>> = {}
      for (const [repo, bases] of byRepo)
        next[repo] = await window.api.worktrees.pushState(repo, [...bases])
      setPushState(next)
    } catch (err) {
      // Swallowing the failure quietly makes the stale list on screen look current — a refresh failure is reported
      const raw = err instanceof Error ? err.message : String(err)
      console.error('worktrees.overview failed:', raw)
      const m = worktreeErrorMessage(raw)
      toast.error(t(m.key, m.params))
      setFailed(t(m.key, m.params))
    }
  }, [t, onRows, repoFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Notified when spawn() in App.tsx creates a worktree through NewSessionDialog's "split into a
  // worktree" option — this panel only re-queries once at mount, on a manual ⟳ click and on expand, so
  // it subscribes in order not to miss a worktree created in between.
  useEffect(() => subscribeCreated(() => void refresh()), [refresh])

  const remove = async (w: WorktreeListItem): Promise<void> => {
    const ok = await confirmModal({
      title: t('worktree.remove.title'),
      body: t('worktree.remove.body', { name: w.name, branch: w.branch, path: w.path }),
      confirmLabel: t('files.action.delete')
    })
    if (!ok) return
    // Wait for the list refresh before dropping the spinner — dropping it first makes the removed row look like it briefly came back
    const applyResult = async (
      r: Awaited<ReturnType<typeof window.api.worktrees.remove>>
    ): Promise<void> => {
      if (r.branchPreserved)
        toast.info(t('worktree.remove.branchPreserved', { branch: r.branchPreserved.branch }))
      else toast.success(t('worktree.remove.done'))
      await refresh()
    }
    // Removing a row that is still on screen because the list refresh failed (a phantom row) hits
    // NOT_MANAGED, since the target is already gone and no longer in the registry — the generic "not
    // created by this app" wording does not fit that situation, so only here (in the panel) it is
    // replaced with a message that matches what actually happened, and the list is reloaded to clear
    // the phantom row. The generic mapping in worktreeErrors.ts is left as-is for other callers.
    const handleNotManaged = async (): Promise<void> => {
      toast.info(t('worktree.remove.alreadyGone', { name: w.name }))
      await refresh()
    }
    // The cleanliness check (git status), the folder delete and the merge check (including a remote
    // fetch) run back to back and can take over 10 seconds. During that, a spinner shows on this row
    // and every button in the panel is locked — concurrent git commands against the same repo contend
    // on the ref lock, so even though the indication is per-row the lock has to cover the whole panel.
    setRemovingId(w.id)
    try {
      await applyResult(await window.api.worktrees.remove(w.id))
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      if (raw.includes('NOT_MANAGED')) {
        await handleNotManaged()
        return
      }
      const n = dirtyCount(raw)
      const unverifiable = isOrphanUnverifiable(raw)
      if (n === null && !unverifiable) {
        const m = worktreeErrorMessage(raw) // includes codes with no force escape hatch, such as ORPHAN_UNPROVEN
        toast.error(t(m.key, m.params))
        return
      }
      // DIRTY (an actual change count) / ORPHAN_UNVERIFIABLE (cannot be checked) → a second
      // confirmation for a force removal. The wording has to differ between the two cases — a number
      // that was never measured must not be put in a destructive confirmation dialog.
      // While waiting for the answer nothing is in progress, so the spinner is dropped and turned back
      // on once it is approved.
      setRemovingId(null)
      const force = await confirmModal({
        title: unverifiable ? t('worktree.forceRemove.unverifiableTitle') : t('worktree.forceRemove.dirtyTitle'),
        body: unverifiable
          ? t('worktree.forceRemove.unverifiableBody', { name: w.name, path: w.path })
          : t('worktree.forceRemove.dirtyBody', { name: w.name, count: n as number }),
        confirmLabel: t('worktree.forceRemove.confirm')
      })
      if (!force) return
      setRemovingId(w.id)
      try {
        await applyResult(await window.api.worktrees.remove(w.id, { force: true }))
      } catch (err2) {
        const raw2 = err2 instanceof Error ? err2.message : String(err2)
        if (raw2.includes('NOT_MANAGED')) await handleNotManaged()
        else {
          const m2 = worktreeErrorMessage(raw2)
          toast.error(t(m2.key, m2.params))
          await refresh() // realign the list with the backend state even on failure
        }
      }
    } finally {
      setRemovingId(null)
    }
  }

  useImperativeHandle(handle, () => ({
    remove,
    createPr: (w) => setCreating(w),
    refresh,
    pushStateOf: (w) => pushState[w.repoPath]?.[w.baseRef]?.[w.branch]
  }))

  const groups = groupWorktrees(rows)

  const cleanUp = async (): Promise<void> => {
    const ok = await confirmModal({
      title: t('worktrees.cleanup.title', { count: groups.ready.length }),
      body: t('worktrees.cleanup.body', { names: groups.ready.map((r) => r.item.branch).join('\n') }),
      confirmLabel: t('worktrees.cleanup.confirm', { count: groups.ready.length })
    })
    if (!ok) return
    setCleaning(true)
    try {
      const r = await window.api.worktrees.cleanup()
      if (r.kept.length > 0) toast.info(t('worktrees.cleanup.kept', { done: r.removed.length, kept: r.kept.length }))
      else toast.success(t('worktrees.cleanup.done', { count: r.removed.length }))
    } catch (err) {
      const m = worktreeErrorMessage(err instanceof Error ? err.message : String(err))
      toast.error(t(m.key, m.params))
    } finally {
      setCleaning(false)
      await refresh()
    }
  }

  const creatingPush = creating
    ? pushState[creating.repoPath]?.[creating.baseRef]?.[creating.branch]
    : undefined

  const renderRow = (r: WorktreeRow): React.JSX.Element => {
    const w = r.item
    const state = removingId === w.id ? null : rowState(r)
    return (
      <div
        key={w.id}
        className={`worktree-row${selected === w.path ? ' is-selected' : ''}`}
        onClick={() => onSelect(w.path)}
        title={`${w.path}\n${w.branch}`}
        onContextMenu={(ev) => {
          ev.preventDefault() // Electron's own menu would cover ours
          setRowMenu({ x: ev.clientX, y: ev.clientY, w })
        }}
      >
        <span className="worktree-name">
          <span className="worktree-branch">{w.branch}</span>
          {r.owner && r.owner.taskTitles.length > 0 && <span className="worktree-task">{r.owner.taskTitles.join(', ')}</span>}
        </span>
        {state === 'active' && (
          <Chip tone="ok">
            <Icon icon={Activity} size={14} />
            {t('worktrees.state.active')}
          </Chip>
        )}
        {state === 'merged' && (
          <Chip tone="info">
            <Icon icon={GitMerge} size={14} />
            {t('worktrees.state.merged')}
          </Chip>
        )}
        {r.dirty ? <Chip tone="warn">{t('worktrees.dirty', { count: r.dirty })}</Chip> : null}
        {(() => {
          const snap = prs[w.repoPath]
          const slot = rowSlot(snap?.byBranch[w.branch], pushState[w.repoPath]?.[w.baseRef]?.[w.branch])
          if (slot === null) return null
          if (slot.kind === 'pr')
            return <PrBadge pr={slot.pr} stale={snap!.stale} onOpenMenu={(e) => setPrMenu({ x: e.clientX, y: e.clientY, url: slot.pr.url })} />
          return <PushBadge ahead={slot.ahead} base={w.baseRef} disabled={busy || !ghConnected} onCreate={() => setCreating(w)} />
        })()}
        <AheadBehind ahead={r.ahead} behind={r.behind} className="worktree-meta" />
        {/* Shown on hover, focus or selection only (DESIGN-W11 §7: destructive row actions on hover, with a confirm —
            remove() asks first). While a removal runs the start button goes and the delete slot holds the spinner. */}
        <span className={`worktree-actions${removingId === w.id ? ' is-busy' : ''}`} onClick={(ev) => ev.stopPropagation()}>
          {removingId === w.id ? (
            <Button size="sm" loading aria-label={t('worktree.remove.removing')} title={t('worktree.remove.removing')} />
          ) : (
            <>
              {w.status === 'ok' && (
                <IconButton size="sm" icon={<Play size={14} />} label={t('worktree.action.startSession')} disabled={busy} onClick={() => onStartSession(w.path)} />
              )}
              <IconButton size="sm" className="worktree-delete" icon={<Trash2 size={14} />} label={t('files.action.delete')} disabled={busy} onClick={() => void remove(w)} />
            </>
          )}
        </span>
      </div>
    )
  }

  const section = (key: string, title: string, list: WorktreeRow[], hint?: string): React.JSX.Element | null =>
    list.length === 0 ? null : (
      <div key={key} className="worktree-group">
        <div className="worktree-repo" title={hint}>
          <span className="worktree-repo__name">{title}</span> <span className="worktree-count">{list.length}</span>
        </div>
        <div className="worktree-list">{list.map(renderRow)}</div>
      </div>
    )

  const shown = filterWorktrees(rows, query, reachableOnly)
  const shownGroups = groupWorktrees(shown.reachable)
  const nothingShown = shown.reachable.length === 0 && shown.trouble.length === 0

  return (
    <>
      <PageHeader
        title={t('worktrees.title')}
        subtitle={items.length > 0 ? items.length : undefined}
        actions={
          <>
            {groups.ready.length > 0 && (
              <Button variant="primary" loading={cleaning} disabled={busy} onClick={() => void cleanUp()}>
                {t('worktrees.cleanup.button', { count: groups.ready.length })}
              </Button>
            )}
            <Button variant="ghost" icon={<RefreshCw size={16} />} disabled={busy || cleaning} onClick={() => void refresh()}>
              {t('worktree.refresh')}
            </Button>
            {actions}
          </>
        }
        filters={
          items.length > 0 && (
            <>
              <Input
                type="search"
                className="worktrees-search"
                placeholder={t('worktrees.search')}
                aria-label={t('worktrees.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button size="sm" variant="ghost" className={`worktrees-chip${reachableOnly ? ' is-active' : ''}`} aria-pressed={reachableOnly} onClick={() => setReachableOnly((v) => !v)}>
                {t('worktrees.reachableOnly')}
              </Button>
            </>
          )
        }
      />
      {failed !== null && items.length === 0 ? (
        <EmptyState icon={TriangleAlert} title={t('worktrees.title')}>
          {failed}
        </EmptyState>
      ) : read === null ? null : items.length === 0 ? (
        <EmptyState icon={FolderGit2} title={t('worktrees.emptyTitle')}>
          {t('worktrees.empty')}
        </EmptyState>
      ) : (
        <div className="worktrees-page__split">
          <section className="worktree-panel worktrees-page__list" aria-label={t('worktrees.title')}>
            {nothingShown && <p className="worktree-empty">{t('worktrees.noMatch')}</p>}
            {shownGroups.plans.map((p) => section(p.jobId, p.plan, p.rows))}
            {section('ready', t('worktrees.group.ready'), shownGroups.ready, t('worktrees.group.readyHint'))}
            {section('yours', t('worktrees.group.yours'), shownGroups.yours, t('worktrees.group.yoursHint'))}
            {shown.trouble.map((g) => (
              <div key={g.status} className="worktree-group worktree-group--trouble">
                <div className="worktree-warning" role="note">
                  <Icon icon={TriangleAlert} size={14} />
                  <span>
                    <strong>{t(STATUS_LABEL[g.status])}</strong> <span className="worktree-count">{g.rows.length}</span>
                    <span className="worktree-warning__hint">{t(TROUBLE_HINT[g.status])}</span>
                  </span>
                </div>
                <div className="worktree-list">{g.rows.map(renderRow)}</div>
              </div>
            ))}
          </section>
          {children}
        </div>
      )}
      {prMenu && (
        <ContextMenu
          x={prMenu.x}
          y={prMenu.y}
          onClose={() => setPrMenu(null)}
          items={[
            {
              label: t('github.badge.openInBrowser'),
              onSelect: () => void window.api.system.openExternal(prMenu.url)
            },
            {
              label: t('github.badge.copyLink'),
              onSelect: () => {
                window.api.clipboard.writeText(prMenu.url)
                toast.success(t('github.badge.linkCopied'))
              }
            }
          ]}
        />
      )}
      {rowMenu &&
        (() => {
          const w = rowMenu.w
          const pr = prs[w.repoPath]?.byBranch[w.branch]
          const ahead = pushState[w.repoPath]?.[w.baseRef]?.[w.branch]?.ahead
          const items: MenuItem[] = pr
            ? [
                {
                  label: t('github.badge.openInBrowser'),
                  onSelect: () => void window.api.system.openExternal(pr.url)
                },
                {
                  label: t('github.badge.copyLink'),
                  onSelect: () => {
                    window.api.clipboard.writeText(pr.url)
                    toast.success(t('github.badge.linkCopied'))
                  }
                }
              ]
            : []
          // A closed or merged PR keeps its badge (the slot shows the further-along fact), but the
          // branch can be proposed again — without this the row would offer only Open/Copy forever.
          // A merged branch is usually ahead === 0, so the disabled rule below keeps it quiet.
          if (!pr || pr.state !== 'open') {
            if (items.length > 0) items.push('separator')
            // MenuItem has no hint field, so a disabled item states its reason in its own label
            // (spec §5). Order matters: nothing to merge is the more specific answer.
            items.push({
              label:
                ahead === 0
                  ? t('worktree.push.noCommits')
                  : !ghConnected
                    ? t('worktree.push.ghDisconnected')
                    : t('worktree.push.createPr'),
              // busy needs no reason in the label — the row is visibly spinning
              disabled: ahead === 0 || !ghConnected || busy,
              onSelect: () => setCreating(w)
            })
          }
          return (
            <ContextMenu x={rowMenu.x} y={rowMenu.y} items={items} onClose={() => setRowMenu(null)} />
          )
        })()}
      {creating && (
        <CreatePrDialog
          worktree={creating}
          base={creating.baseRef}
          // A `gone` upstream — configured once, then deleted on the remote — is not on the
          // remote. Treating it as pushed skips the push and hands the person a raw gh failure.
          needsPush={!creatingPush?.hasUpstream || creatingPush.upstreamGone}
          onCancel={() => setCreating(null)}
          onDone={() => {
            setCreating(null)
            // refresh() ends with github.refresh({ force: true }) itself, so this one call turns
            // the ↑N into #N — a second explicit refresh here is absorbed by the coordinator's
            // in-flight guard and its minimum call spacing, and buys nothing.
            void refresh()
          }}
        />
      )}
    </>
  )
})
