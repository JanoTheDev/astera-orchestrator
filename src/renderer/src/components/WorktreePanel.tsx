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
import { PlayIcon, TrashIcon } from './JobIcons'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { CreatePrDialog } from './CreatePrDialog'
import { PrBadge } from './PrBadge'
import { PushBadge } from './PushBadge'
import { rowSlot } from './rowSlot'
import { RefreshCw } from 'lucide-react'
import { Button, Chip } from './ui'

/** 상태 라벨. **'폴더 없음' 은 없다** — 폴더가 사라졌다고 확인된 항목은 listWithStatus 가 목록을
 *  만들면서 레지스트리에서 걷으므로 이 자리에 도달하지 않는다. 그 줄은 눌러도 할 일이 없는 정보였고,
 *  예약 작업이 워크트리를 쌓으면서 스물일곱 개까지 늘어 하나씩 지워야 했다. '닿을 수 없음' 은 다르다 —
 *  멈춘 네트워크 드라이브처럼 확인이 확답을 주지 못한 항목이라 잊지 않고 그렇게 보여 준다. */
const STATUS_LABEL: Record<WorktreeListItem['status'], MessageKey | null> = {
  ok: null,
  'orphan-dir': 'worktree.status.orphanDir',
  unreachable: 'worktree.status.unreachable',
  // git 이 목록을 주지 못했다 — 'git 등록 소실' 로 보이면 사람이 지워도 되는 잔해로 읽는다
  'git-unchecked': 'worktree.status.gitUnchecked'
}

/** What the Worktrees page can ask of the list (W9-J): the actions its detail header shares with the rows. */
export interface WorktreeListHandle {
  remove(w: WorktreeListItem): Promise<void>
  createPr(w: WorktreeListItem): void
  refresh(): Promise<void>
  pushStateOf(w: WorktreeListItem): BranchPushState | undefined
}

/** The Worktrees page's left list (W9-J): the worktrees this app created (per the registry), grouped per plan, "Ready
 *  to clean up" and "Yours". The refresh, the PR/push badges and the remove flow with its confirmations are the
 *  sidebar panel's, unchanged. */
export const WorktreePanel = forwardRef<
  WorktreeListHandle,
  {
    selected: string | null
    onSelect: (path: string) => void
    onStartSession: (path: string) => void
    /** The rows as last read, for the detail beside the list. */
    onRows?: (rows: WorktreeRow[]) => void
  }
>(function WorktreePanel({ selected, onSelect, onStartSession, onRows }, handle): React.JSX.Element | null {
  const { t } = useI18n()
  const [rows, setRows] = useState<WorktreeRow[]>([])
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
      const overview = await window.api.worktrees.overview()
      setRows(overview)
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
      const m = worktreeErrorMessage(err instanceof Error ? err.message : String(err))
      toast.error(t(m.key, m.params))
    }
  }, [t, onRows])

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
            {r.owner && r.owner.taskTitles.length > 0 && <span className="worktree-task"> · {r.owner.taskTitles.join(', ')}</span>}
            {(r.ahead ?? 0) + (r.behind ?? 0) > 0 && (
              <span className="worktree-aheadbehind"> ↑{r.ahead ?? '?'} ↓{r.behind ?? '?'}</span>
            )}
            {r.dirty ? <Chip tone="warn" className="worktree-dirty">{t('worktrees.dirty', { count: r.dirty })}</Chip> : null}
            {/* While removing, the progress state wins — there is no reason to report 'Git registration lost' on a row that is being deleted */}
            {removingId === w.id ? (
              <em className="worktree-status"> ({t('worktree.remove.removing')})</em>
            ) : (
              STATUS_LABEL[w.status] && (
                <em className="worktree-status"> ({t(STATUS_LABEL[w.status]!)})</em>
              )
            )}
          </span>
          {(() => {
            const snap = prs[w.repoPath]
            const slot = rowSlot(snap?.byBranch[w.branch], pushState[w.repoPath]?.[w.baseRef]?.[w.branch])
            if (slot === null) return null
            if (slot.kind === 'pr')
              return (
                <PrBadge
                  pr={slot.pr}
                  stale={snap!.stale}
                  onOpenMenu={(e) =>
                    setPrMenu({ x: e.clientX, y: e.clientY, url: slot.pr.url })
                  }
                />
              )
            return (
              <PushBadge
                ahead={slot.ahead}
                base={w.baseRef}
                disabled={busy || !ghConnected}
                onCreate={() => setCreating(w)}
              />
            )
          })()}
          {/* Drawn icons rather than text glyphs, the same as the history session rows this list
              is laid out to match: both hold 12px marks in a .ghost button, so the two lists'
              rows come out the same height. .icon-btn (28×28, 16px glyph) is for the panel
              header toolbar and was far too big inside a row.
              PlayIcon and TrashIcon come from JobIcons rather than being redrawn here — that
              file's own rule, that one meaning must not grow a second shape. */}
          <span className="worktree-actions" onClick={(ev) => ev.stopPropagation()}>
            {removingId === w.id ? (
              // A session must not be started on a worktree that is being removed, so the start
              // button is taken away, and for delete the button box stays while only the icon
              // becomes a spinner. The spinner is sized down to the 12px the icons are (see
              // .worktree-actions .ghost.removing .loading-spinner) — at its shared 14px this
              // row alone would grow while the delete runs and the list would jump
              <button className="ghost danger removing" disabled aria-label={t('worktree.remove.removing')}>
                <span className="loading-spinner" aria-hidden="true" />
              </button>
            ) : (
              <>
                {w.status === 'ok' && (
                  <button
                    className="ghost"
                    title={t('worktree.action.startSession')}
                    aria-label={t('worktree.action.startSession')}
                    disabled={busy}
                    onClick={() => onStartSession(w.path)}
                  >
                    <PlayIcon />
                  </button>
                )}
                <button
                  className="ghost danger"
                  title={t('files.action.delete')}
                  aria-label={t('files.action.delete')}
                  disabled={busy}
                  onClick={() => void remove(w)}
                >
                  <TrashIcon />
                </button>
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
          {title} <span className="worktree-count">{list.length}</span>
        </div>
        <div className="worktree-list">{list.map(renderRow)}</div>
      </div>
    )

  return (
    <section className="worktree-panel">
      <header className="panel-header">
        <h2 className="panel-title">{t('worktrees.title')}</h2>
        <div className="panel-actions">
          {groups.ready.length > 0 && (
            <Button size="sm" variant="primary" loading={cleaning} disabled={busy} onClick={() => void cleanUp()}>
              {t('worktrees.cleanup.button', { count: groups.ready.length })}
            </Button>
          )}
          <button className="icon-btn" title={t('worktree.refresh')} aria-label={t('worktree.refresh')} disabled={busy || cleaning} onClick={() => void refresh()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </header>
      {items.length === 0 && <p className="modal-hint worktree-empty">{t('worktrees.empty')}</p>}
      {groups.plans.map((p) => section(p.jobId, p.plan, p.rows))}
      {section('ready', t('worktrees.group.ready'), groups.ready, t('worktrees.group.readyHint'))}
      {section('yours', t('worktrees.group.yours'), groups.yours, t('worktrees.group.yoursHint'))}
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
    </section>
  )
})
