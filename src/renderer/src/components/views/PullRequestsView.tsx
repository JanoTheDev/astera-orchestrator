// The Pull requests side bar view: the current project's open PRs (pr.listOpen), each with Review with AI, Open on
// GitHub and a Merge menu. The list reloads on mount, on Refresh and every 2 minutes while this view is the shown one.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RepoPr } from '../../../../core/github/types'
import { coarseDuration } from '../../../../core/usage/relativeTime'
import { confirmModal } from '../../lib/confirm'
import { localDoor } from '../../lib/orchDoor'
import { toast } from '../../lib/toast'
import { useI18n } from '../../i18n/I18nProvider'
import { useProjectScope } from '../../state/useProjectScope'
import { startCodeReviewWithToast } from '../review/codeReviewSession'
import { Badge, Button, EmptyState, Icon, Input, Menu, ViewContainer, ViewPane } from '../ui'
import { openSettings } from '../shell/navigation'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { canMerge, filterPrs, MERGE_METHODS, prRowView, type MergeMethod, type PrListFailure } from './pullRequests'
import './pullRequests.css'

const REFRESH_MS = 2 * 60_000

type Load = { state: 'loading' } | { state: 'ready'; prs: RepoPr[] } | { state: 'failed'; kind: PrListFailure; message: string }

export function PullRequestsView(p: SideBarViewProps): React.JSX.Element {
  const { t } = p
  const { lang } = useI18n()
  const { path, isAll } = useProjectScope()
  const visible = p.activity === 'prs'
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [query, setQuery] = useState('')
  // a merge in flight, and the last merge's outcome per PR number (shown inline under the row)
  const [merging, setMerging] = useState<number | null>(null)
  const [notes, setNotes] = useState<Record<number, { ok: boolean; text: string }>>({})

  const refresh = useCallback(async (): Promise<void> => {
    if (!path) return
    try {
      const r = await window.api.pr.listOpen({ cwd: path })
      setLoad(r.ok ? { state: 'ready', prs: r.prs } : { state: 'failed', kind: r.kind, message: r.message })
    } catch (e) {
      setLoad({ state: 'failed', kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [path])

  useEffect(() => {
    if (!path || !visible) return
    setLoad((l) => (l.state === 'ready' ? l : { state: 'loading' }))
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [path, visible, refresh])

  const review = (pr: RepoPr): void => {
    if (!path) return
    void startCodeReviewWithToast(localDoor(window.api, path), { cwd: path, target: { kind: 'pr', number: pr.number, url: pr.url, title: pr.title, base: pr.base, head: pr.head } }, t)
  }

  const merge = async (pr: RepoPr, method: MergeMethod): Promise<void> => {
    if (!path) return
    const ok = await confirmModal({
      title: t('worktrees.mergePr.title', { number: pr.number }),
      body: t('worktrees.mergePr.body', { title: pr.title, branch: pr.head, base: pr.base, method: t(`worktrees.act.method.${method}`) }),
      confirmLabel: t('worktrees.mergePr.confirm'),
      danger: true
    })
    if (!ok) return
    setMerging(pr.number)
    const note = (ok: boolean, text: string): void => setNotes((n) => ({ ...n, [pr.number]: { ok, text } }))
    try {
      const r = await window.api.pr.merge({ cwd: path, number: pr.number, method })
      if (r.ok) {
        note(true, t('worktrees.mergePr.done', { number: pr.number }))
        void refresh()
      } else {
        note(false, r.kind === 'not-mergeable' ? t('prs.notMergeable') : r.kind === 'already-merged' ? t('prs.alreadyMerged') : t('worktrees.mergePr.failed', { reason: r.detail }))
      }
    } catch (e) {
      note(false, t('worktrees.mergePr.failed', { reason: e instanceof Error ? e.message : String(e) }))
    } finally {
      setMerging(null)
    }
  }

  const prs = load.state === 'ready' ? load.prs : []
  const shown = useMemo(() => filterPrs(prs, query), [prs, query])
  const now = Date.now()
  const title = t('shell.activity.prs')

  const body = ((): React.ReactNode => {
    if (isAll || !path) return <p className="wb-view-empty">{t('prs.noProject')}</p>
    if (load.state === 'loading') return <p className="wb-view-empty">{t('prs.loading')}</p>
    if (load.state === 'ready') {
      if (prs.length === 0) return <p className="wb-view-empty">{t('prs.empty')}</p>
      if (shown.length === 0) return <p className="wb-view-empty">{t('prs.noMatch')}</p>
      return (
        <ul className="prs-list" aria-label={t('prs.list')}>
          {shown.map((pr) => {
            const v = prRowView(pr, now)
            const note = notes[pr.number]
            return (
              <li key={pr.number} className="prs-row">
                <div className="prs-title" title={pr.title}>
                  {v.title}
                  {v.draft && <Badge>{t('prs.draft')}</Badge>}
                </div>
                <div className="prs-meta" title={v.meta}>{v.meta}</div>
                <div className="prs-stats">
                  {v.checks && <Badge tone={v.checks.tone}>{t(v.checks.key)}</Badge>}
                  <span className="prs-add">+{v.size.additions}</span>
                  <span className="prs-del">−{v.size.deletions}</span>
                  <span className="prs-age">{t('prs.updated', { age: coarseDuration(v.ageMs, lang) })}</span>
                </div>
                <div className="prs-actions">
                  <Button size="sm" variant="secondary" onClick={() => review(pr)}>
                    {t('prs.review')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => window.api.system.openExternal(pr.url)}>
                    <Icon name="external" size={14} />
                    {t('prs.github')}
                  </Button>
                  <Menu
                    label={t('prs.menu')}
                    align="end"
                    trigger={{ size: 'sm', variant: 'ghost', disabled: !canMerge(pr, merging !== null), children: <>{t('prs.merge')}<Icon name="chevronDown" size={14} /></> }}
                    items={MERGE_METHODS.map((m) => ({ id: m, label: t(`worktrees.act.method.${m}`), onSelect: () => void merge(pr, m) }))}
                  />
                </div>
                {note && (
                  <p className={`prs-note ${note.ok ? 'ok' : 'bad'}`} role={note.ok ? 'status' : 'alert'}>
                    {note.text}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )
    }
    switch (load.kind) {
      case 'not-installed':
        return <EmptyState role="alert">{t('prs.notInstalled')}</EmptyState>
      case 'not-authenticated':
        return (
          <EmptyState role="alert" action={<Button size="sm" variant="secondary" onClick={() => openSettings('integrations', 'github')}>{t('prs.openSettings')}</Button>}>
            {t('prs.notAuthenticated')}
          </EmptyState>
        )
      case 'no-remote':
        return <EmptyState>{t('prs.noRemote')}</EmptyState>
      default:
        return (
          <EmptyState role="alert" action={<Button size="sm" variant="secondary" onClick={() => void refresh()}>{t('prs.refresh')}</Button>}>
            {t('prs.error', { detail: load.message })}
          </EmptyState>
        )
    }
  })()

  return (
    <ViewContainer label={title}>
      <ViewToolbar label={title} items={[{ id: 'refresh', icon: <Icon name="refresh" />, label: t('prs.refresh'), onClick: () => void refresh() }]} />
      <ViewPane title={title} count={load.state === 'ready' && prs.length > 0 ? prs.length : undefined} storageKey="prs.list">
        {load.state === 'ready' && prs.length > 0 && <Input className="prs-filter" value={query} placeholder={t('prs.filter')} aria-label={t('prs.filter')} onChange={(e) => setQuery(e.target.value)} />}
        {body}
      </ViewPane>
    </ViewContainer>
  )
}
