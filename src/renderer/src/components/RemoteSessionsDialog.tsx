// Sessions on a paired Runtime: open one in a tab, or start a new one there (remote runtime design Phase 9b, N13,
// D8.3). Reached from the new session dialog's runtime choice. Everything is a Host command on that Runtime; the
// folder is one of the Runtime's registered projects (a controller starts sessions only there, §4.8), never a local
// picker, and its path is shown as text.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createSessionArgs, refOf, remoteCall, type RemoteSessionRef, type RemoteSessionRow } from '../lib/remoteSessions'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { AccountDisclosure, AccountSelect } from './AccountSelect'
import { Button, Card, Field, Icon, Menu, Modal, Tabs, menuPointOf, nextFocusIndex, type MenuItem } from './ui'
import './overlays.css'
import './sessionDialog.css'

interface RemoteAccount {
  id: string
  label: string
  provider: 'claude' | 'codex'
  default?: true
  signedIn?: boolean
}

const errorOf = (r: { status: number; body: unknown }): string =>
  String((r.body as { error?: unknown } | null)?.error ?? r.status)

export function RemoteSessionsDialog({
  runtimes,
  runtimeId,
  readOnly,
  onRuntime,
  onLocal,
  onOpen,
  onCancel
}: {
  runtimes: Array<{ runtimeId: string; name: string }>
  runtimeId: string
  /** A read-only pairing lists and opens; it cannot start a session. */
  readOnly: boolean
  onRuntime: (runtimeId: string) => void
  /** Back to the new session dialog for this computer. */
  onLocal: () => void
  onOpen: (ref: RemoteSessionRef) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [rows, setRows] = useState<RemoteSessionRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<RemoteAccount[]>([])
  const [projects, setProjects] = useState<Array<{ name: string | null; path: string }>>([])
  const [kind, setKind] = useState<'terminal' | 'chat'>('terminal')
  const [accountId, setAccountId] = useState('') // '' is Auto (most room): no account is sent and the Runtime picks
  const [acctOpen, setAcctOpen] = useState(false)
  const [cwd, setCwd] = useState('')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; row: RemoteSessionRow } | null>(null)

  // The running list: read on opening, again on Retry and after a Close.
  const readRows = useCallback((): (() => void) => {
    let alive = true
    setRows(null)
    setListError(null)
    void remoteCall(runtimeId, 'sessions-list', {}).then(
      (r) => {
        if (!alive) return
        if (r.status === 200 && Array.isArray(r.body)) setRows(r.body as RemoteSessionRow[])
        else setListError(errorOf(r))
      },
      (e) => alive && setListError(String(e))
    )
    return () => {
      alive = false
    }
  }, [runtimeId])
  const stopList = useRef<(() => void) | null>(null)
  const reload = (): void => {
    stopList.current?.()
    stopList.current = readRows()
  }

  useEffect(() => {
    let alive = true
    setAccounts([])
    setProjects([])
    setAccountId('')
    setCwd('')
    stopList.current = readRows()
    void remoteCall(runtimeId, 'accounts-list', {}).then(
      (r) => {
        if (!alive || r.status !== 200 || !Array.isArray(r.body)) return
        const list = r.body as RemoteAccount[]
        setAccounts(list)
      },
      () => {}
    )
    void window.api.remote.projects(runtimeId).then(
      (list) => {
        if (!alive || !list) return
        const withPath = list.filter((p): p is { id: string; name: string | null; path: string } => typeof p.path === 'string')
        setProjects(withPath)
        setCwd(withPath[0]?.path ?? '')
      },
      () => {}
    )
    return () => {
      alive = false
      stopList.current?.()
    }
  }, [runtimeId, readRows])

  const closeSession = async (r: RemoteSessionRow): Promise<void> => {
    try {
      const done = await remoteCall(runtimeId, 'sessions-close', { id: r.id })
      if (done.status !== 200) return void toast.error(t('remote.session.failed', { message: errorOf(done) }))
      toast.success(t('remote.sessions.closed', { name: r.title ?? r.id }))
    } catch (e) {
      toast.error(t('remote.session.failed', { message: String(e) }))
    }
    reload()
  }
  const rowMenu = (r: RemoteSessionRow): Array<MenuItem | 'separator'> => [
    { id: 'open', label: t('remote.sessions.menu.open'), icon: <Icon name="external" size={14} />, onSelect: () => onOpen(refOf(runtimeId, r)) },
    { id: 'copyId', label: t('remote.sessions.menu.copyId'), icon: <Icon name="copy" size={14} />, onSelect: () => window.api.clipboard.writeText(r.id) },
    { id: 'close', label: t('remote.sessions.menu.close'), icon: <Icon name="close" size={14} />, danger: true, disabled: readOnly, onSelect: () => void closeSession(r) }
  ]

  const start = async (): Promise<void> => {
    setStarting(true)
    setStartError(null)
    try {
      const r = await remoteCall(runtimeId, 'sessions-create', createSessionArgs({ kind, accountId, cwd, title, prompt }))
      if (r.status !== 200 || !r.body || typeof r.body !== 'object') {
        setStartError(errorOf(r))
        return
      }
      onOpen(refOf(runtimeId, r.body as RemoteSessionRow))
    } catch (e) {
      setStartError(String(e))
    } finally {
      setStarting(false)
    }
  }

  const live = (rows ?? []).filter((r) => r.alive)
  // Up/Down/Home/End move between session rows; Tab still walks them in order.
  const rovingRows = (e: React.KeyboardEvent): void => {
    const rowEls = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [])
    const next = nextFocusIndex(rowEls.indexOf(document.activeElement as HTMLElement), rowEls.length, e.key, 'vertical')
    if (next === null) return
    e.preventDefault()
    rowEls[next]?.focus()
  }
  // Auto needs a signed-in account on the Runtime to rank; without one the picker stays open to show why
  const anySignedIn = accounts.some((a) => a.signedIn !== false)
  const canStart = !readOnly && !starting && anySignedIn && cwd !== ''

  return (
    <Modal
      title={t('remote.sessions.title')}
      onClose={() => !starting && onCancel()}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={starting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canStart} onClick={() => void start()}>
            {starting ? t('remote.sessions.starting') : t('remote.sessions.start')}
          </Button>
        </>
      }
    >
      <div className="sd-body">
        <Field
          kind="select"
          label={t('remote.sessions.runtime')}
          options={[
            { value: 'local', label: t('remote.sessions.thisComputer') },
            ...runtimes.map((r) => ({ value: r.runtimeId, label: r.name }))
          ]}
          value={runtimeId}
          disabled={starting}
          onChange={(e) => (e.target.value === 'local' ? onLocal() : onRuntime(e.target.value))}
        />

        <div className="sd-group">
          <span className="sd-label">{t('remote.sessions.running')}</span>
          {listError !== null ? (
            <div className="sd-row">
              <p className="sd-warn">{t('remote.session.failed', { message: listError })}</p>
              <Button size="sm" icon={<Icon name="refresh" size={14} />} onClick={reload}>
                {t('remote.sessions.retry')}
              </Button>
            </div>
          ) : rows === null ? (
            <p className="sd-hint">{t('remote.sessions.loading')}</p>
          ) : live.length === 0 ? (
            <p className="sd-hint">{t('remote.sessions.none')}</p>
          ) : (
            <ul ref={listRef} className="ov-remote-list" onKeyDown={rovingRows}>
              {live.map((r) => (
                <li key={r.id}>
                  <Card
                    className="ov-remote-row"
                    data-roving=""
                    onClick={() => onOpen(refOf(runtimeId, r))}
                    onContextMenu={(e: React.MouseEvent) => {
                      e.preventDefault()
                      setMenu({ at: menuPointOf(e), row: r })
                    }}
                  >
                    <span className="remote-session-name">{r.title ?? r.id}</span>
                    <span className="remote-session-meta">
                      {[t(r.kind === 'chat' ? 'session.kind.chat' : 'session.kind.terminal'), r.provider, r.cwd]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>

        <h3 className="remote-sessions-new">{t('remote.sessions.new')}</h3>
        {readOnly && <p className="sd-hint">{t('remote.sessions.readOnly')}</p>}
        <div className="sd-group sd-group--ruled">
          <span className="sd-label">{t('session.new.kindLabel')}</span>
          <Tabs
            variant="segmented"
            label={t('session.new.kindLabel')}
            value={kind}
            onChange={setKind}
            items={(['terminal', 'chat'] as const).map((k) => ({
              id: k,
              label: t(k === 'chat' ? 'session.kind.chat' : 'session.kind.terminal'),
              disabled: readOnly || starting
            }))}
          />
        </div>
        <div className="sd-group">
          <span className="sd-label">{t('remote.sessions.account')}</span>
          {(() => {
            const picker = (
              <AccountSelect
                accounts={accounts.map((a) => ({ id: a.id, label: a.label, configDir: '', color: '', createdAt: '', provider: a.provider }))}
                loginMap={Object.fromEntries(accounts.map((a) => [a.id, a.signedIn !== false]))}
                value={accountId}
                allLabel={t('accounts.auto')}
                disabled={readOnly || starting}
                onChange={setAccountId}
              />
            )
            return anySignedIn ? (
              <AccountDisclosure
                id="remote-accounts"
                open={acctOpen}
                onToggle={() => setAcctOpen((v) => !v)}
                summary={accounts.find((a) => a.id === accountId)?.label ?? t('accounts.auto')}
              >
                {picker}
              </AccountDisclosure>
            ) : (
              <>
                {picker}
                {accounts.length > 0 && <p className="sd-warn">{t('session.new.blocked.noAccount')}</p>}
              </>
            )
          })()}
        </div>
        {projects.length === 0 ? (
          <div className="sd-group">
            <span className="sd-label">{t('remote.sessions.folder')}</span>
            <p className="sd-hint">{t('remote.sessions.noProjects')}</p>
          </div>
        ) : (
          <Field
            kind="select"
            label={t('remote.sessions.folder')}
            options={projects.map((p) => ({ value: p.path, label: p.name ?? p.path, meta: p.name ? p.path : undefined }))}
            value={cwd}
            disabled={readOnly || starting}
            onChange={(e) => setCwd(e.target.value)}
          />
        )}
        <Field label={t('remote.sessions.sessionTitle')} value={title} disabled={readOnly} onChange={(e) => setTitle(e.target.value)} />
        <Field kind="textarea" label={t('remote.sessions.prompt')} value={prompt} disabled={readOnly} rows={3} onChange={(e) => setPrompt(e.target.value)} />
        {startError !== null && <p className="sd-warn">{t('remote.session.failed', { message: startError })}</p>}
      </div>
      {menu && <Menu at={menu.at} items={rowMenu(menu.row)} label={t('remote.sessions.menu.label')} onClose={() => setMenu(null)} />}
    </Modal>
  )
}
