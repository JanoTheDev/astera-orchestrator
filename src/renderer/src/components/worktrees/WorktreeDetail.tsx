// W9-J: the right side of the Worktrees page: what one worktree is, what it changed against its base, and its commits.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ChangedFile } from '../../../../core/git/changedFile'
import type { WorktreeDetail as Detail, WorktreeRow } from '../../../../core/worktrees/cleanup'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { DiffView } from '../DiffView'
import { Button, Card, Chip, Icon, Menu, type ChipTone } from '../ui'
import { openConsole } from '../shell/navigation'
import type { WorktreeListHandle } from '../WorktreePanel'

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
      <Icon icon={ArrowUp} size={14} />
      {ahead ?? '?'}
      <Icon icon={ArrowDown} size={14} />
      {behind ?? '?'}
    </span>
  )
}

export function WorktreeDetail({
  row,
  list,
  onStartSession,
  onOpenFiles
}: {
  row: WorktreeRow
  list: React.RefObject<WorktreeListHandle | null>
  onStartSession: (path: string) => void
  onOpenFiles: (path: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const w = row.item
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined)
  const [diff, setDiff] = useState<Diff | null>(null)

  // Read again for each worktree, and whenever the list read the folder anew (a commit or an edit moved it)
  useEffect(() => {
    let alive = true
    setDiff(null)
    if (w.status !== 'ok') return setDetail(null)
    void window.api.worktrees.detail(w.id).then(
      (d) => alive && setDetail(d),
      () => alive && setDetail(null)
    )
    return () => {
      alive = false
    }
  }, [w.id, w.status, row.ahead, row.dirty, row.unpushed])

  const showDiff = (f: ChangedFile): void => {
    if (diff?.fileId === f.id) return setDiff(null)
    setDiff({ fileId: f.id, state: 'loading' })
    void window.api.worktrees.fileDiff(w.id, f.id).then(
      (d) => setDiff((cur) => (cur?.fileId !== f.id ? cur : d ? { fileId: f.id, state: 'shown', ...d } : { fileId: f.id, state: 'failed' })),
      () => setDiff((cur) => (cur?.fileId !== f.id ? cur : { fileId: f.id, state: 'failed' }))
    )
  }

  const st = stateOf(row)
  const push = list.current?.pushStateOf(w)
  const unknown = t('worktrees.fact.unknown')
  const files = detail?.files ?? null

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
        <div className="worktree-detail__actions">
          {row.owner?.sessionId && (
            <Button size="sm" icon={<Icon name="terminal" size={14} />} onClick={() => openConsole(row.owner!.sessionId!)}>
              {t('worktrees.detail.console')}
            </Button>
          )}
          <Button size="sm" icon={<Icon name="run" size={14} />} disabled={w.status !== 'ok'} onClick={() => onStartSession(w.path)}>
            {t('worktrees.detail.openHere')}
          </Button>
          <Button size="sm" icon={<Icon name="folder" size={14} />} disabled={w.status !== 'ok'} onClick={() => onOpenFiles(w.path)}>
            {t('worktrees.detail.openFiles')}
          </Button>
          <Menu
            label={t('worktrees.detail.more')}
            align="end"
            trigger={{ icon: <Icon name="more" />, size: 'sm' }}
            items={[
              {
                id: 'pr',
                label: push?.ahead === 0 ? t('worktree.push.noCommits') : t('worktree.push.createPr'),
                disabled: push?.ahead === 0,
                onSelect: () => list.current?.createPr(w)
              },
              {
                id: 'copy',
                label: t('worktrees.detail.copyPath'),
                onSelect: () => {
                  window.api.clipboard.writeText(w.path)
                  toast.success(t('worktrees.detail.pathCopied'))
                }
              }
            ]}
          />
          {/* remove() confirms first (and a second time before a forced removal). */}
          <Button size="sm" variant="danger" icon={<Icon name="delete" size={14} />} className="worktree-detail__delete" onClick={() => void list.current?.remove(w)}>
            {t('files.action.delete')}
          </Button>
        </div>
      </header>

      <div className="worktree-facts">
        <Fact label={t('worktrees.fact.plan')} value={row.owner?.plan ?? t('worktrees.fact.none')} />
        {row.owner && row.owner.taskTitles.length > 0 && <Fact label={t('worktrees.fact.task')} value={row.owner.taskTitles.join(', ')} />}
        <Fact label={t('worktrees.fact.tree')} value={row.dirty === null ? unknown : row.dirty === 0 ? t('worktrees.fact.treeClean') : t('worktrees.fact.treeDirty', { count: row.dirty })} tone={row.dirty ? 'warn' : undefined} />
        <Fact label={t('worktrees.fact.unpushed')} value={row.unpushed === null ? unknown : String(row.unpushed)} tone={row.unpushed ? 'warn' : undefined} />
        <Fact label={t('worktrees.fact.session')} value={row.live ? t('worktrees.fact.sessionLive') : t('worktrees.fact.sessionNone')} />
        <Fact label={w.path} value="" path />
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
                  <span className={`changed-file-status is-${f.status}`}>{t(`jobs.changes.status.${f.status}` as never)}</span>
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

function Fact({ label, value, tone, path }: { label: string; value: string; tone?: 'warn'; path?: boolean }): React.JSX.Element {
  return (
    <Card tone={tone === 'warn' ? 'need' : 'plain'} className={path ? 'worktree-fact worktree-fact--path' : 'worktree-fact'}>
      <span className="worktree-fact__label">{label}</span>
      {value !== '' && <span className="worktree-fact__value">{value}</span>}
    </Card>
  )
}
