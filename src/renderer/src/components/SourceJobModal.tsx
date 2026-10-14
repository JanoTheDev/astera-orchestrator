import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Account, SourcesCallAnswer } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { AccountSelect } from './AccountSelect'
import { backdropProps } from '../lib/backdrop'
import { createPause } from '../lib/pausedSearch'

// The Jobs view's "+ 소스에서" (plugin Phase 4 J20, §3): pick a source, find a ticket, read it, and make a Job from it
// in one step. The Host does the work (window.api.sources, main's sources route); this window keeps what the person
// picked and what came back. The rules it keeps are pure functions below, and what it shows is SourceJobView, so the
// node-only renderer tests cover both; SourceJobModal is the state and the calls between them.

/** A source as `sources-list` answers it. */
export interface SourceRow {
  id: string
  displayName: string
  ready: boolean
  reason?: string
  needsProject: boolean
}

/** An item as `sources-items` answers it, and as `sources-show` answers it read whole. */
export interface ItemRow {
  id: string
  title: string
  status?: string
  url?: string
  summary?: string
  selectable?: boolean
  reason?: string
  jobs?: string[]
}
export interface ItemDetail extends ItemRow {
  body?: string
  fields?: Record<string, string>
}

/** The list under the search: the request it shows (`seq`), its items, the next page's cursor, whether the Host cut
 *  it, and the error that takes its place. */
export interface ListState {
  seq: number
  items: ItemRow[]
  nextCursor?: string
  cut?: boolean
  error?: string
  loading: boolean
}
export const EMPTY_LIST: ListState = { seq: 0, items: [], loading: false }

/** How long the search waits after the last key (J12): GitHub's search is rate limited. */
export const SEARCH_PAUSE_MS = 300

/** A source as an option of the dropdown: one that is not ready is greyed with its reason, and cannot be picked
 *  (§3.1), so it is never asked for items (Review Focus 4). */
export function sourceChoice(s: SourceRow): { value: string; label: string; disabled: boolean } {
  return { value: s.id, label: s.ready ? s.displayName : `${s.displayName} (${s.reason ?? ''})`, disabled: !s.ready }
}

/** The list once the answer to request `seq` came back. An answer to an older request is dropped, so a slow first
 *  search never replaces a newer one (Review Focus 1); `append` adds a page ("More") to what is shown. */
export function listAfter(state: ListState, seq: number, answer: SourcesCallAnswer, append: boolean): ListState {
  if (seq !== state.seq) return state
  if (!answer.ok) {
    const { error: _old, ...rest } = state
    return { ...rest, loading: false, error: answer.message }
  }
  const items = Array.isArray(answer.body.items) ? (answer.body.items as ItemRow[]) : []
  const next = typeof answer.body.nextCursor === 'string' ? answer.body.nextCursor : undefined
  return {
    seq,
    items: append ? [...state.items, ...items] : items,
    ...(next !== undefined ? { nextCursor: next } : {}),
    ...(answer.body.cut === true ? { cut: true } : {}),
    loading: false
  }
}

/** Whether "Make the Job" may be pressed: an item that can be picked, read whole; a coordinator account (§3.4); not
 *  while a make is out, and never again after one whose answer was lost (Review Focus 3). */
export function canMake(a: { item: ItemRow | null; account: string; busy: boolean; locked: boolean }): boolean {
  return a.item !== null && a.item.selectable !== false && a.account !== '' && !a.busy && !a.locked
}

/** What a make's answer means: the Job made, or why not. A lost answer or a deadline may have made the Job, so the
 *  window locks rather than offer a second (Review Focus 3). */
export function madeOutcome(answer: SourcesCallAnswer): { made: string } | { error: string; lock: boolean } {
  if (answer.ok) return { made: String(answer.body.id) }
  return { error: answer.message, lock: answer.code === 'HOST_LOST' || answer.code === 'TIMEOUT' }
}

export interface SourceJobViewProps {
  /** null while the sources load. */
  sources: SourceRow[] | null
  sourcesError?: string
  source: string
  query: string
  list: ListState
  picked?: string
  detail: ItemDetail | null
  detailLoading: boolean
  detailError?: string
  /** null while the accounts load. */
  accounts: Account[] | null
  account: string
  convergence: boolean
  busy: boolean
  locked: boolean
  error?: string
  onSource(id: string): void
  onQuery(q: string): void
  onRetry(): void
  onMore(): void
  onPick(id: string): void
  onOpenJob(jobId: string): void
  onOpenLink(url: string): void
  onAccount(id: string): void
  onConvergence(on: boolean): void
  onMake(): void
  onClose(): void
}

export function SourceJobView(p: SourceJobViewProps): React.JSX.Element {
  const { t } = useI18n()
  const makeable = canMake({ item: p.detail, account: p.account, busy: p.busy, locked: p.locked })
  return (
    <div className="modal-backdrop" {...backdropProps(() => !p.busy && p.onClose())}>
      <div className="modal source-job" onClick={(e) => e.stopPropagation()}>
        <h2>{t('jobs.source.title')}</h2>
        <div className="source-pick">
          {p.sources === null ? (
            <p className="modal-hint">{p.sourcesError ?? t('jobs.source.sourcesLoading')}</p>
          ) : (
            <select value={p.source} onChange={(e) => p.onSource(e.target.value)} aria-label={t('jobs.source.source')}>
              <option value="">{t('jobs.source.sourcePick')}</option>
              {p.sources.map((s) => {
                const c = sourceChoice(s)
                return (
                  <option key={c.value} value={c.value} disabled={c.disabled}>
                    {c.label}
                  </option>
                )
              })}
            </select>
          )}
          {p.source !== '' && (
            <input
              type="text"
              value={p.query}
              placeholder={t('jobs.source.searchPlaceholder')}
              aria-label={t('jobs.source.search')}
              onChange={(e) => p.onQuery(e.target.value)}
              autoFocus
            />
          )}
        </div>
        {p.source !== '' && (
          <div className="source-columns">
            <div className="source-items">
              {p.list.error !== undefined ? (
                // A source's error takes the list's place, with a way to ask again (§3)
                <div className="source-error">
                  <p className="warn-text">{p.list.error}</p>
                  <button onClick={p.onRetry}>{t('jobs.source.retry')}</button>
                </div>
              ) : p.list.items.length === 0 ? (
                <p className="modal-hint">{p.list.loading ? t('jobs.source.loading') : t('jobs.source.empty')}</p>
              ) : (
                <ul>
                  {p.list.items.map((i) => {
                    const cannot = i.selectable === false
                    return (
                      <li
                        key={i.id}
                        className={`source-item${cannot ? ' disabled' : ''}${p.picked === i.id ? ' picked' : ''}`}
                        title={cannot ? i.reason : i.title}
                        onClick={() => p.onPick(i.id)}
                      >
                        <span className="source-id">{i.id}</span>
                        <span className="source-title">{i.title}</span>
                        {i.status !== undefined && <span className="source-status">{i.status}</span>}
                        {(i.jobs?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            className="source-exists"
                            onClick={(e) => {
                              e.stopPropagation()
                              p.onOpenJob(i.jobs![0])
                            }}
                          >
                            {t('jobs.source.exists')}
                          </button>
                        )}
                        {cannot && <span className="source-reason">{t('jobs.source.cannotPick', { reason: i.reason ?? '' })}</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
              {p.list.cut === true && <p className="modal-hint">{t('jobs.source.cut')}</p>}
              {p.list.nextCursor !== undefined && p.list.error === undefined && (
                <button disabled={p.list.loading} onClick={p.onMore}>
                  {t('jobs.source.more')}
                </button>
              )}
            </div>
            <div className="source-detail">
              {p.detail !== null ? (
                <>
                  <h3>
                    {p.detail.id} {p.detail.title}
                  </h3>
                  {p.detail.fields !== undefined && Object.keys(p.detail.fields).length > 0 && (
                    <table className="source-fields">
                      <tbody>
                        {Object.entries(p.detail.fields).map(([k, v]) => (
                          <tr key={k}>
                            <th>{k}</th>
                            <td>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {/* Someone else wrote it: shown as the text it is, never as Markdown or HTML (§3.3) */}
                  <pre className="source-body">{p.detail.body ?? ''}</pre>
                  <p className="modal-hint">{t('jobs.source.dataHint')}</p>
                  {p.detail.url !== undefined && (
                    <button type="button" onClick={() => p.onOpenLink(p.detail!.url!)}>
                      {t('jobs.source.openLink')}
                    </button>
                  )}
                  {p.detail.selectable === false && <p className="warn-text">{t('jobs.source.cannotPick', { reason: p.detail.reason ?? '' })}</p>}
                </>
              ) : (
                <p className="modal-hint">{p.detailError ?? (p.detailLoading ? t('jobs.source.loading') : t('jobs.source.pickItem'))}</p>
              )}
            </div>
          </div>
        )}
        {p.accounts !== null && (
          <div className="field">
            <label>{t('jobs.new.coordinator')}</label>
            <AccountSelect accounts={p.accounts} value={p.account} onChange={p.onAccount} allLabel={t('jobs.new.coordinatorPick')} />
            {p.accounts.length === 0 && <p className="warn-text">{t('jobs.task.accountEmpty')}</p>}
          </div>
        )}
        <div className="field">
          <label className="check-small">
            <input type="checkbox" checked={p.convergence} onChange={(e) => p.onConvergence(e.target.checked)} />
            {t('jobs.new.convergence')}
          </label>
          <p className="modal-hint">{t('jobs.new.convergenceHint')}</p>
        </div>
        {p.error !== undefined && <p className="warn">{p.error}</p>}
        <div className="row right">
          <button onClick={p.onClose} disabled={p.busy}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={!makeable} onClick={p.onMake}>
            {t('jobs.source.make')}
          </button>
        </div>
      </div>
    </div>
  )
}

const failure = (e: unknown): SourcesCallAnswer => ({ ok: false, code: 'FAILED', message: e instanceof Error ? e.message : String(e) })

export function SourceJobModal({
  projectPath,
  accounts,
  onClose,
  onCreated,
  onOpenJob
}: {
  /** The project the Job is made in: the Jobs view's, on this machine. */
  projectPath: string
  accounts: Account[] | null
  onClose: () => void
  /** The Job made: the caller opens it (plan P5). */
  onCreated: (jobId: string) => void
  /** "Job exists" on an item (J16): the caller opens that Job. */
  onOpenJob: (jobId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [sources, setSources] = useState<SourceRow[] | null>(null)
  const [sourcesError, setSourcesError] = useState<string>()
  const [source, setSource] = useState('')
  const [query, setQuery] = useState('')
  const [list, setList] = useState<ListState>(EMPTY_LIST)
  const [picked, setPicked] = useState<string>()
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string>()
  const [account, setAccount] = useState('')
  const [convergence, setConvergence] = useState(false)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string>()
  /** The latest list and detail requests: an answer to an older one is dropped (Review Focus 1). */
  const listSeq = useRef(0)
  const detailSeq = useRef(0)
  /** The source the paused search asks: the one picked when it fires, not when the key was pressed. */
  const sourceRef = useRef('')
  const queryRef = useRef('')

  useEffect(() => {
    let live = true
    window.api.sources.list().then(
      (a) => {
        if (!live) return
        if (!a.ok) setSourcesError(a.message)
        else setSources(Array.isArray(a.body.sources) ? (a.body.sources as SourceRow[]) : [])
      },
      (e: unknown) => {
        if (live) setSourcesError(e instanceof Error ? e.message : String(e))
      }
    )
    return () => {
      live = false
    }
  }, [])

  const search = useCallback(
    async (src: string, q: string, cursor?: string): Promise<void> => {
      if (src === '') return
      const mine = ++listSeq.current
      setList((s) => (cursor !== undefined ? { ...s, seq: mine, loading: true } : { seq: mine, items: [], loading: true }))
      let answer: SourcesCallAnswer
      try {
        answer = await window.api.sources.items({ source: src, projectPath, ...(q !== '' ? { query: q } : {}), ...(cursor !== undefined ? { cursor } : {}) })
      } catch (e) {
        answer = failure(e)
      }
      setList((s) => listAfter(s, mine, answer, cursor !== undefined))
    },
    [projectPath]
  )
  const pause = useMemo(() => createPause(SEARCH_PAUSE_MS, (q) => void search(sourceRef.current, q)), [search])
  useEffect(() => () => pause.cancel(), [pause])

  const pick = async (id: string): Promise<void> => {
    setPicked(id)
    setDetail(null)
    setDetailError(undefined)
    setDetailLoading(true)
    const mine = ++detailSeq.current
    let answer: SourcesCallAnswer
    try {
      answer = await window.api.sources.show({ source: sourceRef.current, item: id, projectPath })
    } catch (e) {
      answer = failure(e)
    }
    if (mine !== detailSeq.current) return
    setDetailLoading(false)
    if (answer.ok) setDetail(answer.body as unknown as ItemDetail)
    else setDetailError(answer.message)
  }

  const make = async (): Promise<void> => {
    // Checked again here: the button's disabled may not be drawn yet on a second quick press
    if (!canMake({ item: detail, account, busy, locked }) || detail === null) return
    setBusy(true)
    setError(undefined)
    try {
      const outcome = madeOutcome(
        await window.api.sources.create({ source: sourceRef.current, item: detail.id, projectPath, coordinatorAccount: account, ...(convergence ? { convergence: true } : {}) })
      )
      if ('made' in outcome) {
        onCreated(outcome.made)
        return
      }
      setError(outcome.lock ? t('jobs.source.lost') : outcome.error)
      if (outcome.lock) setLocked(true)
    } catch {
      // The IPC itself failed: whether the Job was made is not known, so no second one is offered
      setError(t('jobs.source.lost'))
      setLocked(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SourceJobView
      sources={sources}
      sourcesError={sourcesError}
      source={source}
      query={query}
      list={list}
      picked={picked}
      detail={detail}
      detailLoading={detailLoading}
      detailError={detailError}
      accounts={accounts}
      account={account}
      convergence={convergence}
      busy={busy}
      locked={locked}
      error={error}
      onSource={(id) => {
        pause.cancel()
        sourceRef.current = id
        queryRef.current = ''
        setSource(id)
        setQuery('')
        setPicked(undefined)
        setDetail(null)
        setDetailError(undefined)
        ++detailSeq.current
        if (id === '') {
          ++listSeq.current
          setList(EMPTY_LIST)
        } else void search(id, '')
      }}
      onQuery={(q) => {
        queryRef.current = q
        setQuery(q)
        pause.type(q)
      }}
      onRetry={() => void search(sourceRef.current, queryRef.current)}
      onMore={() => list.nextCursor !== undefined && void search(sourceRef.current, queryRef.current, list.nextCursor)}
      onPick={(id) => void pick(id)}
      onOpenJob={onOpenJob}
      onOpenLink={(url) => void window.api.system.openExternal(url)}
      onAccount={setAccount}
      onConvergence={setConvergence}
      onMake={() => void make()}
      onClose={onClose}
    />
  )
}
