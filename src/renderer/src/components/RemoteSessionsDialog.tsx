// Sessions on a paired Runtime: open one in a tab, or start a new one there (remote runtime design Phase 9b, N13,
// D8.3). Reached from the new session dialog's runtime choice. Everything is a Host command on that Runtime; the
// folder is one of the Runtime's registered projects (a controller starts sessions only there, §4.8), never a local
// picker, and its path is shown as text.
import { useEffect, useRef, useState } from 'react'
import { createSessionArgs, refOf, remoteCall, type RemoteSessionRef, type RemoteSessionRow } from '../lib/remoteSessions'
import { useI18n } from '../i18n/I18nProvider'
import { AccountSelect } from './AccountSelect'
import { Button, Card, Modal, Select, Tabs, nextFocusIndex } from './ui'
import './overlays.css'

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
  const [accountId, setAccountId] = useState('')
  const [cwd, setCwd] = useState('')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let alive = true
    setRows(null)
    setListError(null)
    setAccounts([])
    setProjects([])
    setAccountId('')
    setCwd('')
    void remoteCall(runtimeId, 'sessions-list', {}).then(
      (r) => {
        if (!alive) return
        if (r.status === 200 && Array.isArray(r.body)) setRows(r.body as RemoteSessionRow[])
        else setListError(errorOf(r))
      },
      (e) => alive && setListError(String(e))
    )
    void remoteCall(runtimeId, 'accounts-list', {}).then(
      (r) => {
        if (!alive || r.status !== 200 || !Array.isArray(r.body)) return
        const list = r.body as RemoteAccount[]
        setAccounts(list)
        setAccountId((list.find((a) => a.default && a.signedIn !== false) ?? list.find((a) => a.signedIn !== false) ?? list[0])?.id ?? '')
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
    }
  }, [runtimeId])

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
  const canStart = !readOnly && !starting && accountId !== '' && cwd !== ''

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
      <div className="dlg remote-sessions">
        <div className="field">
          <label>{t('remote.sessions.runtime')}</label>
          <Select
            items={[
              { value: 'local', label: t('remote.sessions.thisComputer') },
              ...runtimes.map((r) => ({ value: r.runtimeId, label: r.name }))
            ]}
            value={runtimeId}
            disabled={starting}
            onChange={(v) => (v === 'local' ? onLocal() : onRuntime(v))}
          />
        </div>

        <div className="field">
          <label>{t('remote.sessions.running')}</label>
          {listError !== null ? (
            <p className="warn">{t('remote.session.failed', { message: listError })}</p>
          ) : rows === null ? (
            <p className="modal-hint">{t('remote.sessions.loading')}</p>
          ) : live.length === 0 ? (
            <p className="modal-hint">{t('remote.sessions.none')}</p>
          ) : (
            <ul ref={listRef} className="ov-remote-list" onKeyDown={rovingRows}>
              {live.map((r) => (
                <li key={r.id}>
                  <Card className="ov-remote-row" data-roving="" onClick={() => onOpen(refOf(runtimeId, r))}>
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
        {readOnly && <p className="modal-hint">{t('remote.sessions.readOnly')}</p>}
        <div className="field kind-field">
          <label>{t('session.new.kindLabel')}</label>
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
        <div className="field">
          <label>{t('remote.sessions.account')}</label>
          <AccountSelect
            accounts={accounts.map((a) => ({ id: a.id, label: a.label, configDir: '', color: '', createdAt: '', provider: a.provider }))}
            loginMap={Object.fromEntries(accounts.map((a) => [a.id, a.signedIn !== false]))}
            value={accountId}
            disabled={readOnly || starting}
            onChange={setAccountId}
          />
        </div>
        <div className="field">
          <label>{t('remote.sessions.folder')}</label>
          {projects.length === 0 ? (
            <p className="modal-hint">{t('remote.sessions.noProjects')}</p>
          ) : (
            <Select
              items={projects.map((p) => ({ value: p.path, label: p.name ?? p.path, meta: p.name ? p.path : undefined }))}
              value={cwd}
              disabled={readOnly || starting}
              onChange={setCwd}
            />
          )}
        </div>
        <div className="field">
          <label>{t('remote.sessions.sessionTitle')}</label>
          <input type="text" value={title} disabled={readOnly} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('remote.sessions.prompt')}</label>
          <textarea value={prompt} disabled={readOnly} rows={3} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        {startError !== null && <p className="warn">{t('remote.session.failed', { message: startError })}</p>}
      </div>
    </Modal>
  )
}
