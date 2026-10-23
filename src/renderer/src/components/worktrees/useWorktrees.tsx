// The worktree list's data and actions, shared by the Source Control view (the list) and a worktree's tab (its detail):
// what the registry holds with its state, the PR / push badges' data, and the remove, clean-up and create-PR flows with
// their confirmations. Each caller reads on its own; GitHub's subscription is counted in main.
import { useCallback, useEffect, useState } from 'react'
import type { BranchPushState, WorktreeListItem } from '../../../../core/types'
import { groupWorktrees, type WorktreeRow } from '../../../../core/worktrees/cleanup'
import type { RepoPrSnapshot } from '../../../../core/github/types'
import { confirmModal } from '../../lib/confirm'
import { toast } from '../../lib/toast'
import { dirtyCount, isOrphanUnverifiable, worktreeErrorMessage } from '../../lib/worktreeErrors'
import { subscribeCreated } from '../../lib/worktreeBus'
import { useI18n } from '../../i18n/I18nProvider'
import { CreatePrDialog } from '../CreatePrDialog'
import { Menu } from '../ui'

export interface Worktrees {
  /** Null until the first list arrives: before it (or when it failed) nothing is known. */
  rows: WorktreeRow[] | null
  /** Why the last refresh failed, until one succeeds. */
  failed: string | null
  /** A removal is running: every action locks (concurrent git commands on one repo contend on the ref lock). */
  busy: boolean
  /** The worktree whose removal is in progress. */
  removingId: string | null
  cleaning: boolean
  ghConnected: boolean
  prs: Record<string, RepoPrSnapshot>
  /** Ready-to-clean-up rows. */
  ready: WorktreeRow[]
  refresh(): Promise<void>
  /** Confirms first, and a second time before a forced removal. */
  remove(w: WorktreeListItem): Promise<void>
  cleanUp(): Promise<void>
  createPr(w: WorktreeListItem): void
  openPrMenu(at: { x: number; y: number }, url: string): void
  pushStateOf(w: WorktreeListItem): BranchPushState | undefined
  /** The PR link menu and the create-PR dialog: render once next to the list. */
  overlays: React.ReactNode
}

export function useWorktrees(repoFilter?: (repoPath: string) => boolean): Worktrees {
  const { t } = useI18n()
  // Null until the first list arrives: before it (or when it failed) nothing is known, and "No worktrees yet" would be a lie
  const [read, setRows] = useState<WorktreeRow[] | null>(null)
  // Why the last refresh failed, shown in place of the list until one succeeds: a toast alone leaves an empty page
  const [failed, setFailed] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [prs, setPrs] = useState<Record<string, RepoPrSnapshot>>({})
  // PR link menu — one at a time, held here rather than per row (the FileExplorer/HistoryBrowser shape)
  const [prMenu, setPrMenu] = useState<{ x: number; y: number; url: string } | null>(null)
  const [pushState, setPushState] = useState<
    Record<string, Record<string, Record<string, BranchPushState>>>
  >({})
  // The row whose create dialog is open, if any
  const [creating, setCreating] = useState<WorktreeListItem | null>(null)
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
  }, [t, repoFilter])

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
      confirmLabel: t('files.action.delete'),
      danger: true
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
        confirmLabel: t('worktree.forceRemove.confirm'),
        danger: true
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

  const ready = groupWorktrees(read ?? []).ready

  const cleanUp = async (): Promise<void> => {
    const ok = await confirmModal({
      title: t('worktrees.cleanup.title', { count: ready.length }),
      body: t('worktrees.cleanup.body', { names: ready.map((r) => r.item.branch).join('\n') }),
      confirmLabel: t('worktrees.cleanup.confirm', { count: ready.length })
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

  const pushStateOf = (w: WorktreeListItem): BranchPushState | undefined => pushState[w.repoPath]?.[w.baseRef]?.[w.branch]
  const creatingPush = creating ? pushStateOf(creating) : undefined

  const overlays = (
    <>
      {prMenu && (
        <Menu
          at={prMenu}
          label={t('worktrees.prMenu')}
          onClose={() => setPrMenu(null)}
          items={[
            { label: t('github.badge.openInBrowser'), onSelect: () => void window.api.system.openExternal(prMenu.url) },
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

  return {
    rows: read,
    failed,
    busy,
    removingId,
    cleaning,
    ghConnected,
    prs,
    ready,
    refresh,
    remove,
    cleanUp,
    createPr: setCreating,
    openPrMenu: (at, url) => setPrMenu({ ...at, url }),
    pushStateOf,
    overlays
  }
}
