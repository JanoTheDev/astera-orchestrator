// A worktree's tab (DESIGN-W13 §5, `view:worktree:<path>`): what the worktree is, which plan and task made it, what it
// changed against its base, its commits, and the actions on it (Open console here, Create pull request, Delete).
import { useCallback, useRef, useState } from 'react'
import type { ChangedFile } from '../../../../core/git/changedFile'
import type { WorktreeRow } from '../../../../core/worktrees/cleanup'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { DiffView } from '../DiffView'
import { Button, Card, Chip, EmptyState, ICONS, Icon, IconButton, type ChipTone } from '../ui'
import { changeLetter } from '../explorerChanged'
import { openConsole, openPlan } from '../shell/navigation'
import { useWorktreeDetail } from './useWorktreeDetail'
import { useWorktrees, type Worktrees } from './useWorktrees'

type Diff = { fileId: string } & ({ state: 'loading' } | { state: 'shown'; diff: string; truncated: boolean } | { state: 'failed' })

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

/** The tab's body for the worktree at `path`: it reads the list itself (the Source Control view has its own copy). */
export function WorktreeDetail({
  path,
  onStartSession,
  onOpenFiles,
  repoFilter
}: {
  path: string | null
  onStartSession: (path: string) => void
  onOpenFiles: (path: string) => void
  /** Only the open project's worktrees. The latest one is used; a new function each render does not re-read the list. */
  repoFilter?: (repoPath: string) => boolean
}): React.JSX.Element | null {
  const { t } = useI18n()
  const latest = useRef(repoFilter)
  latest.current = repoFilter
  const stable = useCallback((repo: string) => latest.current?.(repo) ?? true, [])
  const wt = useWorktrees(stable)
  const row = path === null ? undefined : wt.rows?.find((r) => r.item.path === path)
  if (wt.rows === null && wt.failed === null) return null
  return (
    <div className="worktree-tab">
      {row ? (
        <Body row={row} wt={wt} onStartSession={onStartSession} onOpenFiles={onOpenFiles} />
      ) : (
        <EmptyState icon={wt.failed !== null ? ICONS.warning : ICONS.repo} title={t('worktrees.pickTitle')}>
          {wt.failed ?? t('worktrees.gone')}
        </EmptyState>
      )}
      {wt.overlays}
    </div>
  )
}

function Body({ row, wt, onStartSession, onOpenFiles }: { row: WorktreeRow; wt: Worktrees; onStartSession: (path: string) => void; onOpenFiles: (path: string) => void }): React.JSX.Element {
  const { t } = useI18n()
  const w = row.item
  const detail = useWorktreeDetail(row)
  const [diff, setDiff] = useState<Diff | null>(null)

  const showDiff = (f: ChangedFile): void => {
    if (diff?.fileId === f.id) return setDiff(null)
    setDiff({ fileId: f.id, state: 'loading' })
    void window.api.worktrees.fileDiff(w.id, f.id).then(
      (d) => setDiff((cur) => (cur?.fileId !== f.id ? cur : d ? { fileId: f.id, state: 'shown', ...d } : { fileId: f.id, state: 'failed' })),
      () => setDiff((cur) => (cur?.fileId !== f.id ? cur : { fileId: f.id, state: 'failed' }))
    )
  }

  const st = stateOf(row)
  const push = wt.pushStateOf(w)
  const unknown = t('worktrees.fact.unknown')
  const files = detail?.files ?? null
  const ok = w.status === 'ok'

  return (
    <article className="worktree-detail">
      <header className="worktree-detail__head">
        <div className="worktree-detail__title">
          <h2>{w.branch}</h2>
          <Chip tone={st.tone} dot>
            {t(`worktrees.detail.state.${st.key}` as never)}
          </Chip>
          <span className="worktree-detail__base">{t('worktrees.detail.base', { base: w.baseRef })}</span>
          <AheadBehind ahead={row.ahead} behind={row.behind} />
        </div>
        <div className="worktree-detail__path">
          <code title={w.path}>{w.path}</code>
          <IconButton
            size="sm"
            icon={<Icon name="copy" size={14} />}
            label={t('worktrees.detail.copyPath')}
            onClick={() => {
              window.api.clipboard.writeText(w.path)
              toast.success(t('worktrees.detail.pathCopied'))
            }}
          />
        </div>
        <div className="worktree-detail__actions">
          <Button size="sm" icon={<Icon name="run" size={14} />} disabled={!ok} onClick={() => onStartSession(w.path)}>
            {t('worktrees.detail.openHere')}
          </Button>
          {row.owner?.sessionId && (
            <Button size="sm" icon={<Icon name="terminal" size={14} />} onClick={() => openConsole(row.owner!.sessionId!)}>
              {t('worktrees.detail.console')}
            </Button>
          )}
          <Button size="sm" icon={<Icon name="folder" size={14} />} disabled={!ok} onClick={() => onOpenFiles(w.path)}>
            {t('worktrees.detail.openFiles')}
          </Button>
          <Button
            size="sm"
            icon={<Icon name="pullRequest" size={14} />}
            disabled={!ok || push?.ahead === 0 || !wt.ghConnected || wt.busy}
            title={push?.ahead === 0 ? t('worktree.push.noCommits') : !wt.ghConnected ? t('worktree.push.ghDisconnected') : undefined}
            onClick={() => wt.createPr(w)}
          >
            {t('worktree.push.createPr')}
          </Button>
          {/* remove() confirms first (and a second time before a forced removal). */}
          <Button size="sm" variant="danger" icon={<Icon name="delete" size={14} />} className="worktree-detail__delete" disabled={wt.busy} onClick={() => void wt.remove(w)}>
            {t('files.action.delete')}
          </Button>
        </div>
      </header>

      <div className="worktree-facts">
        <Card tone="plain" className="worktree-fact">
          <span className="worktree-fact__label">{t('worktrees.fact.plan')}</span>
          {row.owner ? (
            <Button size="sm" variant="ghost" className="worktree-link" icon={<Icon name="listTree" size={14} />} onClick={() => openPlan(row.owner!.jobId)}>
              {row.owner.plan}
            </Button>
          ) : (
            <span className="worktree-fact__value">{t('worktrees.fact.none')}</span>
          )}
        </Card>
        {row.owner && row.owner.taskTitles.length > 0 && (
          <Card tone="plain" className="worktree-fact">
            <span className="worktree-fact__label">{t('worktrees.fact.task')}</span>
            {row.owner.taskTitles.map((title, i) => (
              <Button key={row.owner!.taskIds[i] ?? title} size="sm" variant="ghost" className="worktree-link" onClick={() => openPlan(row.owner!.jobId)}>
                {title}
              </Button>
            ))}
          </Card>
        )}
        <Fact label={t('worktrees.fact.tree')} value={row.dirty === null ? unknown : row.dirty === 0 ? t('worktrees.fact.treeClean') : t('worktrees.fact.treeDirty', { count: row.dirty })} tone={row.dirty ? 'warn' : undefined} />
        <Fact label={t('worktrees.fact.unpushed')} value={row.unpushed === null ? unknown : String(row.unpushed)} tone={row.unpushed ? 'warn' : undefined} />
        <Fact label={t('worktrees.fact.session')} value={row.live ? t('worktrees.fact.sessionLive') : t('worktrees.fact.sessionNone')} />
      </div>

      <section className="worktree-detail__section">
        <h3>{t('worktrees.changes')}</h3>
        {detail === undefined ? (
          <p className="modal-hint">{t('files.editor.loading')}</p>
        ) : files === null ? (
          <p className="modal-hint">{t('worktrees.changes.unavailable')}</p>
        ) : files.length === 0 ? (
          <p className="modal-hint">{t('worktrees.changes.none')}</p>
        ) : (
          <ul className="changed-files-list">
            {files.map((f) => (
              <li key={f.id}>
                <Button variant="ghost" className={`changed-file-row${diff?.fileId === f.id ? ' is-open' : ''}`} aria-expanded={diff?.fileId === f.id} onClick={() => showDiff(f)}>
                  <span className={`changed-file-status is-${f.status}`} title={t(`jobs.changes.status.${f.status}` as never)}>
                    {changeLetter(f.status)}
                  </span>
                  <span className="changed-file-path">{f.path}</span>
                  <span className="changed-file-counts">{f.binary ? t('jobs.changes.binary') : `+${f.additions ?? 0} −${f.deletions ?? 0}`}</span>
                </Button>
                {diff?.fileId === f.id && (
                  <div className="changed-file-diff">
                    {diff.state === 'loading' && <p className="modal-hint">{t('files.editor.loading')}</p>}
                    {diff.state === 'failed' && <p className="warn">{t('worktrees.changes.unavailable')}</p>}
                    {diff.state === 'shown' && <DiffView diff={diff.diff} truncated={diff.truncated} binary={f.binary === true} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="worktree-detail__section">
        <h3>{t('worktrees.commits')}</h3>
        {detail === undefined ? (
          <p className="modal-hint">{t('files.editor.loading')}</p>
        ) : detail === null || detail.commits === null ? (
          <p className="modal-hint">{t('worktrees.commits.unavailable')}</p>
        ) : detail.commits.length === 0 ? (
          <p className="modal-hint">{t('worktrees.commits.none')}</p>
        ) : (
          <ul className="worktree-commits">
            {detail.commits.map((c) => (
              <li key={c.sha}>
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
    </article>
  )
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'warn' }): React.JSX.Element {
  return (
    <Card tone={tone === 'warn' ? 'need' : 'plain'} className="worktree-fact">
      <span className="worktree-fact__label">{label}</span>
      <span className="worktree-fact__value">{value}</span>
    </Card>
  )
}
