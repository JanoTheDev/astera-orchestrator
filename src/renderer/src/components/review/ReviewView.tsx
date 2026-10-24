// Reviewing a folder's work (T7): first how it connects (the summary and the change map), then the code, grouped by
// file and symbol. From any hunk, or a line range picked in it, the owner asks an AI to fix it, edits it, or (for a
// plan Task) requests changes. Keys: j/k move between hunks, v marks the file viewed, a/e/r run the three actions.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChangeMap, ChangeSymbol, ParsedHunk } from '../../../../core/review/changeMap'
import type { JobRow, JobTask } from '../../../../core/types'
import { isWaitingOnDialog, POST_PASTE_SUBMIT_DELAY_MS } from '../../../../core/preview/pick/send'
import { useI18n } from '../../i18n/I18nProvider'
import { confirmModal, confirmModalWithChoices } from '../../lib/confirm'
import { diffLines } from '../../lib/diffLines'
import { sendPlanFeedback, type ActionUi } from '../../lib/jobActions'
import { replyNote, type OrchDoor } from '../../lib/orchDoor'
import * as sessionBus from '../../lib/sessionBus'
import { toast } from '../../lib/toast'
import { DiffView } from '../DiffView'
import { openConsole, openFile, startSession } from '../shell/navigation'
import { Button, Checkbox, Chip, Icon, IconButton, Kbd, Popover, Textarea } from '../ui'
import { ChangeMapView, SymbolMark } from './ChangeMapView'
import { askInNewSession } from './askSession'
import { changeRequestText, fixPrompt, type CodeRef } from './fixPrompt'
import { anchorOf, hunkRange, isViewed, reviewModel, stepHunk, type ReviewFile } from './reviewModel'
import { useChangeMap, useTaskReport, useViewed } from './useReview'
import './review.css'

/** The plan a reviewed folder belongs to; `task` when it is one Task's worktree. */
export interface ReviewOwner {
  plan: JobRow
  task?: JobTask
}

type ActionKind = 'ask' | 'request'
interface Selection {
  hunkId: string
  anchor: number
  from: number
  to: number
}

export function ReviewView({ cwd, base, owner, door }: { cwd: string; base?: string; owner?: ReviewOwner; door: OrchDoor | null }): React.JSX.Element {
  const { t } = useI18n()
  const { map, refresh } = useChangeMap(cwd, base)
  const head = (
    <header className="rv-title">
      <h3>{t('review.title')}</h3>
      <IconButton size="sm" icon={<Icon name="refresh" size={14} />} label={t('review.refresh')} onClick={refresh} />
    </header>
  )
  if (map === undefined || map === null || map.files.length === 0)
    return (
      <section className="rv" aria-label={t('review.title')}>
        {head}
        <p className="rv-note">{map === undefined ? t('review.loading') : map === null ? t('review.unavailable') : t('review.empty', { base: base ?? 'base' })}</p>
      </section>
    )
  return <ReviewBody key={cwd} map={map} cwd={cwd} owner={owner} door={door} head={head} />
}

/** The live worker session of the Task, when one is running it now. */
const liveWorker = (task: JobTask | undefined): string | null => (task?.sessionId && task.provider !== undefined ? task.sessionId : null)

const joinPath = (root: string, rel: string): string => `${root.replace(/[\\/]+$/, '')}/${rel}`

function ReviewBody({ map, cwd, owner, door, head }: { map: ChangeMap; cwd: string; owner?: ReviewOwner; door: OrchDoor | null; head: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n()
  const model = useMemo(() => reviewModel(map), [map])
  const [viewed, toggleViewed] = useViewed(cwd)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const [current, setCurrent] = useState<string | null>(null)
  const [mode, setMode] = useState<'map' | 'list'>('map')
  const [action, setAction] = useState<{ hunkId: string; kind: ActionKind } | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const report = useTaskReport(door, owner?.task?.id)
  const uid = useId().replace(/[^\w-]/g, '')
  const hunkDom = (id: string): string => `rv${uid}-${id}`
  const fileDom = (path: string): string => `rv${uid}-f${model.areas.flatMap((a) => a.files).findIndex((f) => f.file.path === path)}`
  const pendingScroll = useRef<{ id: string; focus: boolean } | null>(null)

  const files = useMemo(() => model.areas.flatMap((a) => a.files), [model])
  const fileByPath = useMemo(() => new Map(files.map((f) => [f.file.path, f])), [files])
  const hunkById = useMemo(() => new Map(map.hunks.map((h) => [h.id, h])), [map])
  const symbolOf = useMemo(() => {
    const m = new Map<string, ChangeSymbol | null>()
    for (const f of files) for (const g of f.groups) for (const h of g.hunks) m.set(h.id, g.symbol)
    return m
  }, [files])
  const collapsed = (f: ReviewFile): boolean => !(opened[f.file.path] ?? !isViewed(viewed, f.file))
  const viewedCount = files.filter((f) => isViewed(viewed, f.file)).length
  const currentPath = current ? (model.fileOf.get(current) ?? null) : null

  // scroll after the render that opened the file the target sits in
  useEffect(() => {
    const p = pendingScroll.current
    if (!p) return
    pendingScroll.current = null
    const el = document.getElementById(p.id)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    if (p.focus) el?.focus({ preventScroll: true })
  })

  const goHunk = (id: string, focus = true): void => {
    const path = model.fileOf.get(id)
    if (path) setOpened((o) => ({ ...o, [path]: true }))
    setCurrent(id)
    pendingScroll.current = { id: hunkDom(id), focus }
  }
  const goFile = (path: string): void => {
    setOpened((o) => ({ ...o, [path]: true }))
    const first = fileByPath.get(path)?.groups[0]?.hunks[0]
    if (first) setCurrent(first.id)
    pendingScroll.current = { id: fileDom(path), focus: false }
  }
  const goSymbol = (s: ChangeSymbol): void => {
    const id = anchorOf(s, model.order)
    if (id) goHunk(id)
    else goFile(s.path)
  }

  const ui: ActionUi = {
    t: (key, params) => (t as (k: string, p?: Record<string, string | number>) => string)(key, params),
    confirm: (o) => confirmModal(o),
    confirmChoices: (o) => confirmModalWithChoices(o),
    error: (m, o) => void toast.error(m, o)
  }

  /** The code an action is about: the picked rows of the hunk, or the whole hunk. */
  const refOf = (h: ParsedHunk): CodeRef => {
    const symbol = symbolOf.get(h.id)?.name
    const sel = selection?.hunkId === h.id ? selection : null
    if (sel) {
      const rows = diffLines(h.text).slice(sel.from, sel.to + 1)
      const nums = rows.map((r) => r.newNo ?? r.oldNo).filter((n): n is number => n !== undefined)
      if (nums.length > 0)
        return { path: h.path, start: Math.min(...nums), end: Math.max(...nums), diff: rows.map((r) => r.text).join('\n'), ...(symbol ? { symbol } : {}) }
    }
    return { path: h.path, ...hunkRange(h), diff: h.text, ...(symbol ? { symbol } : {}) }
  }

  const fail = (reason: string): false => (toast.error(t('review.ask.failed', { reason })), false)

  const ask = async (h: ParsedHunk, note: string): Promise<boolean> => {
    if (!door) return fail(t('review.ask.noProject'))
    const ref = refOf(h)
    const text = fixPrompt(ref, note)
    const worker = liveWorker(owner?.task)
    try {
      if (worker) {
        // the paste path first, as the browser pane sends to a session: bracketed, so its newlines do not submit
        const screen = sessionBus.screenOf(worker)
        if (screen !== null && isWaitingOnDialog(screen)) return fail(t('review.ask.waiting'))
        if (sessionBus.pasteInto(worker, text)) window.setTimeout(() => sessionBus.submitInto(worker), POST_PASTE_SUBMIT_DELAY_MS)
        else {
          const r = await door.command('sessions-send', { id: worker, text })
          if (r.status >= 400) return fail(replyNote(r, ui.t, String(r.status)))
        }
        toast.success(t('review.ask.sent'))
        openConsole(worker)
        return true
      }
      // A new chat session on the Auto account, its tab opened by the workbench's own spawn. Chat, because its turns go
      // over stdio: the quoted diff (quotes, pipes, newlines) arrives whole, where a terminal's first prompt is a
      // command-line argument that refuses them (commands.ts LAUNCH_FORBIDDEN).
      const id = await askInNewSession(text, {
        onReady: (cb) => window.api.on('chat:event', ({ sessionId, event }) => event.type === 'ready' && cb(sessionId)),
        start: () => startSession(cwd, 'chat'),
        send: (sid, prompt) => window.api.chat.send(sid, prompt),
        settled: (o) => o !== 'sent' && fail(o === 'timeout' ? t('review.ask.notReady') : o.message),
        setTimer: (fn, ms) => void window.setTimeout(fn, ms),
        timeoutMs: 60_000
      })
      if (id === null) return false
      toast.success(t('review.ask.started'))
      return true
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }

  const request = async (h: ParsedHunk, note: string): Promise<boolean> => {
    if (!door || !owner?.task) return false
    const ok = await sendPlanFeedback(door, owner.plan.id, changeRequestText(owner.task, refOf(h), note), ui)
    if (ok) toast.success(t('review.request.sent'))
    return ok
  }

  const edit = (h: ParsedHunk): void => {
    const ref = refOf(h)
    openFile(joinPath(cwd, h.path), { line: ref.start })
  }

  const canRequest = owner?.task !== undefined && door !== null

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
    const el = e.target as HTMLElement
    // typing in a field or a popover form is not a review key
    if (el.closest('input, textarea, select, [contenteditable="true"], .ui-popover [role="dialog"]')) return
    const h = current ? hunkById.get(current) : undefined
    const key = e.key.toLowerCase()
    if (key === 'j' || key === 'k') {
      const next = stepHunk(model.order, current, key === 'j' ? 1 : -1)
      if (next) goHunk(next)
    } else if (key === 'v' && currentPath) {
      const f = fileByPath.get(currentPath)
      if (f) toggleViewed(f.file)
    } else if (key === 'a' && h) setAction({ hunkId: h.id, kind: 'ask' })
    else if (key === 'r' && h && canRequest) setAction({ hunkId: h.id, kind: 'request' })
    else if (key === 'e' && h && currentPath && fileByPath.get(currentPath)?.file.status !== 'deleted') edit(h)
    else return
    e.preventDefault()
  }

  const symbolCount = map.symbols.length
  const add = map.files.reduce((n, f) => n + f.additions, 0)
  const del = map.files.reduce((n, f) => n + f.deletions, 0)

  return (
    <section className="rv" aria-label={t('review.title')} onKeyDown={onKey}>
      {head}
      <div className="rv-summary">
        <Chip>{t('review.summary.files', { count: map.total })}</Chip>
        <Chip>
          <span className="rv-add">+{add}</span> <span className="rv-del">−{del}</span>
        </Chip>
        <Chip>{t('review.summary.symbols', { count: symbolCount })}</Chip>
        <Chip tone={viewedCount === files.length ? 'ok' : 'neutral'} dot>
          {t('review.summary.viewed', { viewed: viewedCount, count: files.length })}
        </Chip>
        {map.total > map.files.length && <span className="rv-note">{t('review.summary.partial', { shown: map.files.length, total: map.total })}</span>}
        <span className="rv-mode" role="group" aria-label={t('review.mode.label')}>
          {(['map', 'list'] as const).map((m) => (
            <Button key={m} size="sm" variant="ghost" className={mode === m ? 'is-on' : ''} aria-pressed={mode === m} icon={<Icon name={m === 'map' ? 'layoutGrid' : 'ordered'} size={14} />} onClick={() => setMode(m)}>
              {t(`review.mode.${m}`)}
            </Button>
          ))}
        </span>
      </div>
      {report && (
        <div className="rv-report">
          <strong>{t('review.report.title')}</strong>
          <p className={reportOpen ? '' : 'is-clamped'}>{report}</p>
          {report.length > 240 && (
            <Button size="sm" variant="ghost" aria-expanded={reportOpen} onClick={() => setReportOpen((v) => !v)}>
              {reportOpen ? t('review.report.less') : t('review.report.more')}
            </Button>
          )}
        </div>
      )}

      <div className="rv-body">
        <nav className="rv-side" aria-label={t('review.map.label')}>
          <ChangeMapView areas={model.areas} edges={map.edges} mode={mode} activePath={currentPath} pick={{ onFile: goFile, onSymbol: goSymbol }} />
          <p className="rv-keys">
            <span>{t('review.keys')}:</span> <Kbd>J</Kbd> <Kbd>K</Kbd> {t('review.keys.move')} · <Kbd>V</Kbd> {t('review.keys.viewed')} · <Kbd>A</Kbd> {t('review.hunk.ask')} · <Kbd>E</Kbd>{' '}
            {t('review.hunk.edit')}
            {canRequest && (
              <>
                {' '}
                · <Kbd>R</Kbd> {t('review.hunk.request')}
              </>
            )}
          </p>
        </nav>

        <div className="rv-code" aria-label={t('review.code.label')} role="region">
          {files.map((f) => {
            const shut = collapsed(f)
            const isV = isViewed(viewed, f.file)
            return (
              <section key={f.file.path} id={fileDom(f.file.path)} className={`rv-file${isV ? ' is-viewed' : ''}`}>
                <header className="rv-file__head">
                  <Button
                    variant="ghost"
                    className="rv-file__toggle"
                    aria-expanded={!shut}
                    aria-label={t(shut ? 'review.file.expand' : 'review.file.collapse', { path: f.file.path })}
                    icon={<Icon name={shut ? 'chevronRight' : 'chevronDown'} size={16} />}
                    onClick={() => setOpened((o) => ({ ...o, [f.file.path]: shut }))}
                  >
                    <span className="rv-file__path">{f.file.path}</span>
                  </Button>
                  <span className="rv-counts">
                    <span className="rv-add">+{f.file.additions}</span> <span className="rv-del">−{f.file.deletions}</span>
                  </span>
                  <Checkbox className="rv-file__viewed" checked={isV} onChange={() => toggleViewed(f.file)} label={t('review.file.viewed')} />
                  <IconButton size="sm" icon={<Icon name="edit" size={14} />} label={t('review.hunk.edit')} onClick={() => openFile(joinPath(cwd, f.file.path))} disabled={f.file.status === 'deleted'} />
                </header>
                {!shut && f.file.skipped && <p className="rv-note rv-file__note">{t(`review.skipped.${f.file.skipped}`)}</p>}
                {!shut &&
                  f.groups.map((g) => (
                    <div key={g.symbol ? `${g.symbol.kind}:${g.symbol.name}:${g.symbol.change}` : '-'} className="rv-sym">
                      <h4 className="rv-sym__head">
                        {g.symbol ? (
                          <>
                            <SymbolMark change={g.symbol.change} />
                            <code className="rv-sym__name">{g.symbol.name}</code>
                            <span className="rv-sym__kind">{g.symbol.kind}</span>
                          </>
                        ) : (
                          <span className="rv-sym__kind">{t('review.code.other')}</span>
                        )}
                      </h4>
                      {g.hunks.map((h) => (
                        <Hunk
                          key={h.id}
                          domId={hunkDom(h.id)}
                          hunk={h}
                          current={current === h.id}
                          codeRef={refOf(h)}
                          selection={selection?.hunkId === h.id ? selection : null}
                          action={action?.hunkId === h.id ? action.kind : null}
                          canRequest={canRequest}
                          canAsk={door !== null}
                          canEdit={f.file.status !== 'deleted'}
                          target={liveWorker(owner?.task) ? (owner?.task?.title ?? null) : null}
                          taskTitle={owner?.task?.title ?? ''}
                          onFocus={() => setCurrent(h.id)}
                          onAction={(kind) => setAction(kind ? { hunkId: h.id, kind } : null)}
                          onRowPick={(i, extend) =>
                            setSelection((s) =>
                              extend && s?.hunkId === h.id ? { ...s, from: Math.min(s.anchor, i), to: Math.max(s.anchor, i) } : { hunkId: h.id, anchor: i, from: i, to: i }
                            )
                          }
                          onClearSelection={() => setSelection(null)}
                          onAsk={(note) => ask(h, note)}
                          onRequest={(note) => request(h, note)}
                          onEdit={() => edit(h)}
                        />
                      ))}
                    </div>
                  ))}
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function rangeLabel(t: ReturnType<typeof useI18n>['t'], r: { start: number; end: number }): string {
  return r.start === r.end ? t('review.hunk.line', { start: r.start }) : t('review.hunk.lines', { start: r.start, end: r.end })
}

function Hunk({
  domId,
  hunk,
  current,
  codeRef,
  selection,
  action,
  canRequest,
  canAsk,
  canEdit,
  target,
  taskTitle,
  onFocus,
  onAction,
  onRowPick,
  onClearSelection,
  onAsk,
  onRequest,
  onEdit
}: {
  domId: string
  hunk: ParsedHunk
  current: boolean
  codeRef: CodeRef
  selection: Selection | null
  action: ActionKind | null
  canRequest: boolean
  canAsk: boolean
  /** false for a deleted file: there is nothing to open. */
  canEdit: boolean
  /** The running Task whose worker gets Ask AI; null: a new session. */
  target: string | null
  taskTitle: string
  onFocus: () => void
  onAction: (kind: ActionKind | null) => void
  onRowPick: (index: number, extend: boolean) => void
  onClearSelection: () => void
  onAsk: (note: string) => Promise<boolean>
  onRequest: (note: string) => Promise<boolean>
  onEdit: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const range = rangeLabel(t, codeRef)
  return (
    <div
      id={domId}
      className={`rv-hunk${current ? ' is-current' : ''}${action ? ' is-acting' : ''}`}
      tabIndex={0}
      role="group"
      aria-label={t('review.hunk.label', { range, path: hunk.path })}
      onFocus={(e) => e.currentTarget === e.target && onFocus()}
      onMouseDown={onFocus}
    >
      <div className="rv-hunk__bar" role="group" aria-label={t('review.hunk.actions')}>
        <span className="rv-hunk__range">
          {selection ? t('review.hunk.selected', { range }) : <code>{hunk.header.trim() || range}</code>}
          {selection && <IconButton size="sm" icon={<Icon name="close" size={14} />} label={t('review.hunk.clearSelection')} onClick={onClearSelection} />}
        </span>
        <NotePopover
          open={action === 'ask'}
          onOpenChange={(o) => onAction(o ? 'ask' : null)}
          icon="sparkles"
          label={t('review.hunk.ask')}
          title={t('review.ask.title', { range })}
          hint={!canAsk ? t('review.ask.noProject') : target !== null ? t('review.ask.toWorker', { task: target }) : t('review.ask.toNew')}
          disabled={!canAsk}
          onSend={onAsk}
        />
        <Button size="sm" variant="ghost" icon={<Icon name="edit" size={14} />} disabled={!canEdit} onClick={onEdit}>
          {t('review.hunk.edit')}
        </Button>
        {canRequest && (
          <NotePopover
            open={action === 'request'}
            onOpenChange={(o) => onAction(o ? 'request' : null)}
            icon="message"
            label={t('review.hunk.request')}
            title={t('review.request.title', { range })}
            hint={t('review.request.hint', { task: taskTitle })}
            onSend={onRequest}
          />
        )}
      </div>
      <DiffView diff={hunk.text} truncated={false} binary={false} selected={selection} onRowPick={(i, _row, extend) => onRowPick(i, extend)} />
    </div>
  )
}

/** A hunk action's small form: the owner's note, where it goes, Send. Ctrl+Enter sends. */
function NotePopover({
  open,
  onOpenChange,
  icon,
  label,
  title,
  hint,
  disabled,
  onSend
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  icon: 'sparkles' | 'message'
  label: string
  title: string
  hint: string
  disabled?: boolean
  onSend: (note: string) => Promise<boolean>
}): React.JSX.Element {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  useEffect(() => {
    if (open) area.current?.focus()
  }, [open])
  const send = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      if (await onSend(note)) {
        setNote('')
        onOpenChange(false)
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      label={title}
      panelClassName="rv-pop"
      trigger={(p) => (
        <Button {...p} size="sm" variant="ghost" icon={<Icon name={icon} size={14} />} disabled={disabled} title={disabled ? hint : undefined}>
          {label}
        </Button>
      )}
    >
      <form
        className="rv-pop__form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <strong className="rv-pop__title">{title}</strong>
        <label htmlFor={id}>{t('review.ask.note')}</label>
        <Textarea
          id={id}
          ref={area}
          rows={3}
          value={note}
          placeholder={t('review.ask.placeholder')}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <p className="rv-note">{hint}</p>
        <div className="rv-pop__actions">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" variant="primary" type="submit" loading={busy}>
            {t('review.ask.send')}
          </Button>
        </div>
      </form>
    </Popover>
  )
}
