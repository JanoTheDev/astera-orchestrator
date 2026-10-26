// A worktree's tab (DESIGN-W13 §5, `view:worktree:<path>`): the one worktree it was opened for, what it changed against its
// base, its commits, and the review actions on it: Create PR, View / Merge PR, Merge into the base. The worktree list lives
// in the Source Control side bar only.
import { useCallback, useState } from 'react'
import type { ChangedFile } from '../../../../core/git/changedFile'
import type { WorktreeRow } from '../../../../core/worktrees/cleanup'
import type { JobRow, WorktreeListItem } from '../../../../core/types'
import type { PrInfo } from '../../../../core/github/types'
import { runIdToMerge } from '../../../../core/orchestration/snapshot'
import { useI18n } from '../../i18n/I18nProvider'
import { confirmModal } from '../../lib/confirm'
import { jobName } from '../../lib/jobName'
import type { CommandReply, OrchDoor } from '../../lib/orchDoor'
import { isMac } from '../../lib/platformKeys'
import { toast } from '../../lib/toast'
import { CreatePrDialog } from '../CreatePrDialog'
import { absoluteOf, changedFileLabels, changedFileMenu } from '../changedFileMenu'
import { DiffView } from '../DiffView'
import { Button, Chip, EmptyState, ICONS, Icon, IconButton, Menu, menuPointOf, type ChipTone, type MenuItem } from '../ui'
import { changeLetter } from '../explorerChanged'
import { openConsole, openFile, openPlan } from '../shell/navigation'
import { ReviewSlot } from './ReviewSlot'
import { useWorktreeDetail } from './useWorktreeDetail'
import { useWorktreeTab, type WorktreeTabData } from './useWorktreeTab'
import { useWorktrees } from './useWorktrees'
import { worktreeActions, worktreeMenu, type Gate } from './worktreeActions'
import { planOwnerOfPath, worktreeTitle } from './worktreeView'

type Diff = { fileId: string } & ({ state: 'loading' } | { state: 'shown'; diff: string; truncated: boolean } | { state: 'failed' })

// src/core/github/prMerge.ts's methods; that module runs gh, so the renderer cannot import it
type PrMergeMethod = 'merge' | 'squash' | 'rebase'
const METHODS: PrMergeMethod[] = ['merge', 'squash', 'rebase']

/** The state chip: ready wins, then the plan still running, then merged-but-not-landed, then Yours. */
export function stateOf(r: WorktreeRow): { key: 'ready' | 'running' | 'waiting' | 'yours' | 'broken'; tone: ChipTone } {
  if (r.item.status !== 'ok') return { key: 'broken', tone: 'danger' }
  if (r.ready) return { key: 'ready', tone: 'ok' }
  if (!r.owner) return { key: 'yours', tone: 'neutral' }
  return r.owner.running ? { key: 'running', tone: 'info' } : { key: 'waiting', tone: 'warn' }
}

/** Commits ahead of / behind the base, as lucide arrows and counts; nothing when both are zero or unknown. */
export function AheadBehind({ ahead, behind, className }: { ahead: number | null; behind: number | null; className?: string }): React.JSX.Element | null {
  const { t } = useI18n()
  if ((ahead ?? 0) + (behind ?? 0) === 0) return null
  // The arrows are not in the ui icon registry yet (reported for promotion), so they come in through Icon's `icon` prop.
  const words = t('worktrees.aheadBehind', { ahead: ahead ?? '?', behind: behind ?? '?' })
  return (
    <span className={`worktree-aheadbehind${className ? ` ${className}` : ''}`} title={words} aria-label={words}>
      <Icon name="arrowUp" size={14} />
      {ahead ?? '?'}
      <Icon name="arrowDown" size={14} />
      {behind ?? '?'}
    </span>
  )
}

const failText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The worktree's own menu, from the one per-state list (`worktreeMenu`): the tab and the side-bar row menu both draw
 *  it, each supplying what differs between them. `extra` (Create PR in the side bar) sits before Delete. */
export function worktreeMenuItems(
  t: ReturnType<typeof useI18n>['t'],
  w: WorktreeListItem,
  pr: PrInfo | undefined,
  on: { openHere(): void; openFiles(): void; terminal(): void; remove(): void; removeDisabled?: boolean },
  extra: MenuItem[] = []
): Array<MenuItem | 'separator'> {
  const ok = w.status === 'ok'
  const copy = (text: string, done: string) => (): void => {
    window.api.clipboard.writeText(text)
    toast.success(done)
  }
  const by: Record<ReturnType<typeof worktreeMenu>[number], MenuItem> = {
    openHere: { label: t('worktrees.detail.openHere'), icon: <Icon name="run" size={14} />, disabled: !ok, onSelect: on.openHere },
    openFiles: { label: t('worktrees.detail.openFiles'), icon: <Icon name="folder" size={14} />, disabled: !ok, onSelect: on.openFiles },
    terminal: {
      label: t('worktrees.act.terminal'),
      icon: <Icon name="terminal" size={14} />,
      onSelect: on.terminal
    },
    reveal: {
      label: t('worktrees.act.reveal'),
      icon: <Icon name="folder" size={14} />,
      onSelect: () => void window.api.files.reveal(w.path).catch((err) => toast.error(t('worktrees.act.revealFailed', { detail: failText(err) })))
    },
    copyPath: { label: t('worktrees.detail.copyPath'), icon: <Icon name="copy" size={14} />, onSelect: copy(w.path, t('worktrees.detail.pathCopied')) },
    viewPr: { label: t('worktrees.act.viewPr', { number: pr?.number ?? 0 }), icon: <Icon name="external" size={14} />, onSelect: () => void window.api.system.openExternal(pr!.url) },
    copyPr: { label: t('github.badge.copyLink'), icon: <Icon name="copy" size={14} />, onSelect: copy(pr?.url ?? '', t('github.badge.linkCopied')) },
    remove: { label: t('files.action.delete'), icon: <Icon name="delete" size={14} />, disabled: on.removeDisabled, onSelect: on.remove }
  }
  const out: Array<MenuItem | 'separator'> = []
  for (const id of worktreeMenu({ status: w.status, pr })) {
    if (id === 'remove') out.push('separator', ...extra)
    out.push(by[id])
  }
  return out
}

const replyError = (r: CommandReply): string =>
  typeof r.body === 'object' && r.body !== null && 'error' in r.body ? String((r.body as { error: unknown }).error) : String(r.status)

/** The tab's body for the worktree at `path`. `runs` are the open project's plan rows (to find the plan it belongs
 *  to); `door` runs the plan-level delivery commands, null when no project is open. */
export function WorktreeDetail({
  path,
  runs,
  door,
  onClose,
  onStartSession,
  onOpenFiles,
  onTerminal
}: {
  path: string
  runs: readonly JobRow[]
  door: OrchDoor | null
  onClose: () => void
  onStartSession: (path: string) => void
  onOpenFiles: (path: string) => void
  /** A terminal in the bottom panel, started in this folder. */
  onTerminal: (path: string) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const wt = useWorktreeTab(path)
  if (wt.item === undefined) return null
  if (wt.item === null)
    return (
      <div className="worktree-tab">
        <EmptyState icon={ICONS.repo} title={t('worktrees.removed.title')}>
          <p>{t('worktrees.removed.body', { path })}</p>
          <Button size="sm" variant="primary" onClick={onClose}>
            {t('worktrees.removed.close')}
          </Button>
        </EmptyState>
      </div>
    )
  return (
    <div className="worktree-tab">
      <Body item={wt.item} wt={wt} runs={runs} door={door} onStartSession={onStartSession} onOpenFiles={onOpenFiles} onTerminal={onTerminal} />
    </div>
  )
}

function Body({
  item: w,
  wt,
  runs,
  door,
  onStartSession,
  onOpenFiles,
  onTerminal
}: {
  item: WorktreeListItem
  wt: WorktreeTabData
  runs: readonly JobRow[]
  door: OrchDoor | null
  onStartSession: (path: string) => void
  onOpenFiles: (path: string) => void
  onTerminal: (path: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const detail = useWorktreeDetail({ item: w, ahead: wt.push?.ahead ?? null, dirty: wt.dirty, unpushed: null })
  const [diff, setDiff] = useState<Diff | null>(null)
  const [fileMenu, setFileMenu] = useState<{ at: { x: number; y: number }; file: ChangedFile } | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [commitMenu, setCommitMenu] = useState<{ at: { x: number; y: number }; sha: string; subject: string } | null>(null)
  const repoFilter = useCallback((repo: string) => repo === w.repoPath, [w.repoPath])
  const worktrees = useWorktrees(repoFilter)

  const owner = planOwnerOfPath(runs, w)
  const plan = owner?.row
  const planFolder = owner?.planFolder === true
  const runId = plan ? runIdToMerge(plan, plan.id) : undefined
  const ok = w.status === 'ok'
  const acts = worktreeActions({
    ok,
    ghConnected: wt.ghConnected,
    ahead: wt.push?.ahead ?? null,
    dirty: wt.dirty,
    pr: wt.pr,
    // run-deliver --as push acts on the plan's own folder, until its work landed
    pushable: planFolder && door !== null && runId !== undefined && plan?.pr?.landed === undefined && plan?.outcome !== 'running',
    busy
  })
  const awaiting = planFolder && plan?.awaitingReview === true
  const files = detail?.files ?? null
  const taskTitles = plan ? plan.tasks.filter((x) => x.branch === w.branch).map((x) => x.title) : []

  const showDiff = (f: ChangedFile): void => {
    if (diff?.fileId === f.id) return setDiff(null)
    setDiff({ fileId: f.id, state: 'loading' })
    void window.api.worktrees.fileDiff(w.id, f.id).then(
      (d) => setDiff((cur) => (cur?.fileId !== f.id ? cur : d ? { fileId: f.id, state: 'shown', ...d } : { fileId: f.id, state: 'failed' })),
      () => setDiff((cur) => (cur?.fileId !== f.id ? cur : { fileId: f.id, state: 'failed' }))
    )
  }

  const run = async (work: () => Promise<string | null>, failed: 'worktrees.mergePr.failed' | 'worktrees.mergeBase.failed', done: string): Promise<void> => {
    setBusy(true)
    try {
      const reason = await work()
      if (reason === null) toast.success(done)
      else toast.error(t(failed, { reason }))
    } catch (err) {
      toast.error(t(failed, { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
      void window.api.github.refresh({ force: true })
      await wt.refresh()
    }
  }

  const mergePr = async (method: PrMergeMethod): Promise<void> => {
    const pr = wt.pr
    if (!pr) return
    const methodName = t(`worktrees.act.method.${method}` as never)
    const ok = await confirmModal({
      title: t('worktrees.mergePr.title', { number: pr.number }),
      body: t('worktrees.mergePr.body', { title: pr.title, branch: w.branch, base: w.baseRef, method: methodName }),
      confirmLabel: t('worktrees.mergePr.confirm'),
      danger: true
    })
    if (!ok) return
    await run(
      async () => {
        // a plan Run whose PR Astera recorded is merged through the Run, so the plan reads delivered
        if (planFolder && door && runId && plan?.pr?.url !== undefined) {
          const r = await door.command('run-pr-merge', { run: runId, method })
          return r.status >= 400 ? replyError(r) : null
        }
        const r = await window.api.pr.merge({ cwd: w.path, number: pr.number, method })
        return r.ok ? null : r.detail
      },
      'worktrees.mergePr.failed',
      t('worktrees.mergePr.done', { number: pr.number })
    )
  }

  const mergeBase = async (): Promise<void> => {
    if (!door || !runId) return
    const ok = await confirmModal({
      title: t('worktrees.mergeBase.title', { branch: w.branch, base: w.baseRef }),
      body: t('worktrees.mergeBase.body', { branch: w.branch, base: w.baseRef }),
      confirmLabel: t('worktrees.mergeBase.confirm', { base: w.baseRef }),
      danger: true
    })
    if (!ok) return
    await run(
      async () => {
        const r = await door.command('run-deliver', { run: runId, as: 'push' })
        return r.status >= 400 ? replyError(r) : null
      },
      'worktrees.mergeBase.failed',
      t('worktrees.mergeBase.done', { base: w.baseRef })
    )
  }

  const reason = (g: Gate): string | undefined => (g.reason ? t(g.reason) : undefined)

  const actions = (
    <>
      {acts.createPr.show && (
        <Button size="sm" variant="primary" icon={<Icon name="pullRequest" size={14} />} disabled={acts.createPr.reason !== undefined} title={reason(acts.createPr)} onClick={() => setCreating(true)}>
          {t('worktree.push.createPr')}
        </Button>
      )}
      {acts.viewPr.show && wt.pr && (
        <Button size="sm" icon={<Icon name="external" size={14} />} onClick={() => void window.api.system.openExternal(wt.pr!.url)}>
          {t('worktrees.act.viewPr', { number: wt.pr.number })}
        </Button>
      )}
      {acts.mergePr.show && (
        <span className="wt-split" title={reason(acts.mergePr)}>
          <Button size="sm" variant="primary" icon={<Icon name="merge" size={14} />} disabled={acts.mergePr.reason !== undefined} onClick={() => void mergePr('merge')}>
            {t('worktrees.act.mergePr')}
          </Button>
          <Menu
            label={t('worktrees.act.mergeMethod')}
            align="end"
            trigger={{ size: 'sm', variant: 'primary', icon: <Icon name="chevronDown" size={14} />, disabled: acts.mergePr.reason !== undefined, 'aria-label': t('worktrees.act.mergeMethod') }}
            items={METHODS.map((m) => ({ id: m, label: t(`worktrees.act.method.${m}` as never), onSelect: () => void mergePr(m) }))}
          />
        </span>
      )}
      {acts.mergeBase.show && (
        <Button size="sm" icon={<Icon name="merge" size={14} />} disabled={acts.mergeBase.reason !== undefined} title={reason(acts.mergeBase)} onClick={() => void mergeBase()}>
          {t('worktrees.act.mergeBase', { base: w.baseRef })}
        </Button>
      )}
    </>
  )

  // The same actions as one menu: shown instead of the buttons when the tab is narrow (a container query in worktrees.css)
  const item = (label: string, g: Gate, onSelect: () => void, icon: React.ReactNode): MenuItem[] =>
    g.show ? [{ label: g.reason ? `${label} — ${t(g.reason)}` : label, onSelect, disabled: g.reason !== undefined, icon }] : []
  const more: Array<MenuItem | 'separator'> = [
    ...item(t('worktree.push.createPr'), acts.createPr, () => setCreating(true), <Icon name="pullRequest" size={14} />),
    ...item(wt.pr ? t('worktrees.act.viewPr', { number: wt.pr.number }) : '', acts.viewPr, () => void window.api.system.openExternal(wt.pr!.url), <Icon name="external" size={14} />),
    ...(acts.mergePr.show ? METHODS.flatMap((m) => item(`${t('worktrees.act.mergePr')}: ${t(`worktrees.act.method.${m}` as never)}`, acts.mergePr, () => void mergePr(m), <Icon name="merge" size={14} />)) : []),
    ...item(t('worktrees.act.mergeBase', { base: w.baseRef }), acts.mergeBase, () => void mergeBase(), <Icon name="merge" size={14} />)
  ]
  const secondary = worktreeMenuItems(t, w, wt.pr, {
    openHere: () => onStartSession(w.path),
    openFiles: () => onOpenFiles(w.path),
    terminal: () => onTerminal(w.path),
    removeDisabled: busy || worktrees.busy,
    remove: () => void worktrees.remove(w).then(() => wt.refresh())
  })

  const dirty = wt.dirty
  const treeWords = dirty === null ? t('worktrees.fact.unknown') : dirty === 0 ? t('worktrees.fact.treeClean') : t('worktrees.fact.treeDirty', { count: dirty })

  return (
    <article className="worktree-detail">
      <header className="wt-head">
        <div className="wt-head__id">
          <h2 title={w.path}>{worktreeTitle(w, w.path)}</h2>
          <code className="wt-head__branch">{w.name !== w.branch ? `${w.name} · ${w.branch}` : w.branch}</code>
          <span className="worktree-detail__base">{t('worktrees.detail.base', { base: w.baseRef })}</span>
          <AheadBehind ahead={wt.push?.ahead ?? null} behind={wt.push?.behind ?? null} />
          <Chip tone={dirty ? 'warn' : dirty === 0 ? 'ok' : 'neutral'} dot>
            {treeWords}
          </Chip>
          {plan && (
            <Button size="sm" variant="ghost" className="worktree-link" icon={<Icon name="listTree" size={14} />} title={t('worktrees.plan.link', { plan: jobName(plan) })} onClick={() => openPlan(plan.id)}>
              {taskTitles.length > 0 ? `${jobName(plan)} · ${taskTitles.join(', ')}` : jobName(plan)}
            </Button>
          )}
        </div>
        <div className="wt-head__actions">
          {!awaiting && <div className="wt-actions__inline">{actions}</div>}
          {!awaiting && more.length > 0 && (
            <Menu label={t('worktrees.act.more')} align="end" items={more} trigger={{ size: 'sm', className: 'wt-actions__more', icon: <Icon name="more" size={14} />, 'aria-label': t('worktrees.act.more') }} />
          )}
          <Menu label={t('worktrees.act.other')} align="end" items={secondary} trigger={{ size: 'sm', icon: <Icon name="moreVertical" size={14} />, 'aria-label': t('worktrees.act.other') }} />
        </div>
      </header>

      {awaiting && (
        <section className="wt-review" role="status">
          <div className="wt-review__text">
            <strong>{t('worktrees.review.title')}</strong>
            <span>{t('worktrees.review.body')}</span>
          </div>
          <div className="wt-review__actions">
            <div className="wt-actions__inline">{actions}</div>
            {more.length > 0 && <Menu label={t('worktrees.act.more')} align="end" items={more} trigger={{ size: 'sm', className: 'wt-actions__more', icon: <Icon name="more" size={14} />, 'aria-label': t('worktrees.act.more') }} />}
          </div>
        </section>
      )}

      <section className="worktree-detail__section">
        <h3>{t('worktrees.changes')}</h3>
        {detail === undefined ? (
          <p className="ui-note">{t('files.editor.loading')}</p>
        ) : files === null ? (
          <p className="ui-note">{t('worktrees.changes.unavailable')}</p>
        ) : files.length === 0 ? (
          <p className="ui-note">{t('worktrees.changes.none')}</p>
        ) : (
          <ul className="changed-files-list">
            {files.map((f) => (
              <li key={f.id}>
                <div className="changed-file-item">
                <Button
                  variant="ghost"
                  className={`changed-file-row${diff?.fileId === f.id ? ' is-open' : ''}`}
                  aria-expanded={diff?.fileId === f.id}
                  onClick={() => showDiff(f)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setFileMenu({ at: menuPointOf(e), file: f })
                  }}
                >
                  <span className={`changed-file-status is-${f.status}`} title={t(`jobs.changes.status.${f.status}` as never)}>
                    {changeLetter(f.status)}
                  </span>
                  <span className="changed-file-path">{f.path}</span>
                  <span className="changed-file-counts">{f.binary ? t('jobs.changes.binary') : `+${f.additions ?? 0} −${f.deletions ?? 0}`}</span>
                </Button>
                {f.status !== 'deleted' && (
                  <IconButton size="sm" className="changed-file-open" icon={<Icon name="open" size={14} />} label={t('changedFile.menu.open')} onClick={() => openFile(absoluteOf(w.path, f.path))} />
                )}
                </div>
                {diff?.fileId === f.id && (
                  <div className="changed-file-diff">
                    {diff.state === 'loading' && <p className="ui-note">{t('files.editor.loading')}</p>}
                    {diff.state === 'failed' && <p className="ui-note ui-note--warn">{t('worktrees.changes.unavailable')}</p>}
                    {diff.state === 'shown' && <DiffView diff={diff.diff} truncated={diff.truncated} binary={f.binary === true} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {fileMenu && (
          <Menu
            at={fileMenu.at}
            items={changedFileMenu(
              { status: fileMenu.file.status, path: absoluteOf(w.path, fileMenu.file.path), relative: fileMenu.file.path },
              changedFileLabels(t, isMac()),
              {
                open: openFile,
                diff: () => showDiff(fileMenu.file),
                copy: (text) => window.api.clipboard.writeText(text),
                reveal: (path) =>
                  void window.api.files.reveal(path).catch((err: unknown) => toast.error(t('explorer.reveal.failed', { detail: err instanceof Error ? err.message : String(err) })))
              }
            )}
            onClose={() => setFileMenu(null)}
          />
        )}
      </section>

      <ReviewSlot worktree={w} plan={plan} task={planFolder ? undefined : plan?.tasks.find((x) => x.branch === w.branch)} door={door} />

      <section className="worktree-detail__section">
        <h3>{t('worktrees.commits')}</h3>
        {detail === undefined ? (
          <p className="ui-note">{t('files.editor.loading')}</p>
        ) : detail === null || detail.commits === null ? (
          <p className="ui-note">{t('worktrees.commits.unavailable')}</p>
        ) : detail.commits.length === 0 ? (
          <p className="ui-note">{t('worktrees.commits.none')}</p>
        ) : (
          <ul className="worktree-commits">
            {detail.commits.map((c) => (
              <li key={c.sha} onContextMenu={(e) => { e.preventDefault(); setCommitMenu({ at: menuPointOf(e), sha: c.sha, subject: c.subject }) }}>
                <code>{c.sha.slice(0, 7)}</code>
                <span className="worktree-commits__subject">{c.subject}</span>
                <Chip tone={c.kind === 'ai' ? 'info' : 'neutral'}>
                  {c.kind === 'ai' ? t('worktrees.commit.ai', { agent: c.agent ?? c.author }) : t('worktrees.commit.human', { author: c.author })}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </section>

      {commitMenu && (
        <Menu
          at={commitMenu.at}
          label={t('worktrees.commit.menu')}
          onClose={() => setCommitMenu(null)}
          items={[
            { label: t('worktrees.commit.copySha'), icon: <Icon name="copy" size={14} />, onSelect: () => { window.api.clipboard.writeText(commitMenu.sha); toast.success(t('worktrees.commit.copied')) } },
            { label: t('worktrees.commit.copySubject'), icon: <Icon name="copy" size={14} />, onSelect: () => { window.api.clipboard.writeText(commitMenu.subject); toast.success(t('worktrees.commit.copied')) } }
          ]}
        />
      )}
      {worktrees.overlays}
      {creating && (
        <CreatePrDialog
          worktree={w}
          base={w.baseRef}
          // A `gone` upstream — configured once, then deleted on the remote — is not on the remote
          needsPush={!wt.push?.hasUpstream || wt.push.upstreamGone}
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            void window.api.github.refresh({ force: true })
            void wt.refresh()
          }}
        />
      )}
    </article>
  )
}
