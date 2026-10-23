// A paired device's own tab (`view:device:<runtimeId>`), in the settings editor's row pattern: its status, address,
// permission, accounts (Sign in) and projects (Add project), then New console, Copy my setup again and Unpair. The
// actions moved here from Settings › Remote Runtimes' machine list.
import { useEffect, useState } from 'react'
import type { RemoteRuntimeInfo } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { confirmModal } from '../../lib/confirm'
import { refOf, remoteCall, type RemoteSessionRef, type RemoteSessionRow } from '../../lib/remoteSessions'
import { toast } from '../../lib/toast'
import { failureLine, pingLine } from '../remoteRuntimesText'
import { SettingItem } from '../settings/SettingItem'
import { Button, Chip, EmptyState, ICONS, Input } from '../ui'
import { MigratePanel } from './MigratePanel'
import { deviceState, osName, type DeviceAccount } from './devicesView'
import { refreshDevices, useDevices } from './useDevices'

const STATE_TONE = { online: 'ok', offline: 'warn', unknown: 'neutral' } as const

export function DeviceDetail({
  runtimeId,
  onNewConsole,
  onOpenSession,
  onChanged,
  onClose
}: {
  runtimeId: string
  onNewConsole: (runtimeId: string) => void
  /** Opens a remote session tab (Sign in's login terminal). */
  onOpenSession: (ref: RemoteSessionRef) => void
  /** The device was unpaired: the app's other paired lists read again. */
  onChanged: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const { paired, accountsOf, migratable } = useDevices()
  const r = paired?.find((x) => x.runtimeId === runtimeId)
  const [ping, setPing] = useState<{ line: string; os?: string } | null>(null)
  const [pinging, setPinging] = useState(false)
  const [projects, setProjects] = useState<Array<{ id: string; name: string | null; path: string | null }> | null | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [cloneUrl, setCloneUrl] = useState('')
  const [clonePath, setClonePath] = useState('')
  const [cloning, setCloning] = useState(false)
  const [migrating, setMigrating] = useState(false)

  const readProjects = (): void => void window.api.remote.projects(runtimeId).then(setProjects, () => setProjects(null))
  useEffect(readProjects, [runtimeId])

  if (paired === null) return <div className="view-doc" />
  if (!r)
    return (
      <EmptyState icon={ICONS.screen} title={t('devices.detail.gone')}>
        <Button size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </EmptyState>
    )

  const state = deviceState(r)
  const accounts = accountsOf[runtimeId]
  const check = async (): Promise<void> => {
    setPinging(true)
    try {
      const res = await window.api.remote.ping(runtimeId)
      setPing({ line: pingLine(res, t as never), ...(res.ok && res.hello?.platform ? { os: osName(res.hello.platform) } : {}) })
      refreshDevices()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setPinging(false)
    }
  }
  // A terminal on the device running `astera accounts login --new` (host/loginTerminal.ts), opened as a remote session
  // tab so its login link shows here. A device too old to open one gets the command to run there instead.
  const signIn = async (dev: RemoteRuntimeInfo): Promise<void> => {
    try {
      const done = await remoteCall(dev.runtimeId, 'accounts-login-start', {})
      if (done.status === 200) return onOpenSession(refOf(dev.runtimeId, done.body as RemoteSessionRow))
    } catch {
      /* the copy below is the way left */
    }
    window.api.clipboard.writeText('astera accounts login --new')
    toast.success(t('devices.signInCopied', { name: dev.name }))
  }
  const addProject = async (): Promise<void> => {
    setCloning(true)
    try {
      const done = await remoteCall(runtimeId, 'projects-add', { clone: cloneUrl.trim(), ...(clonePath.trim() ? { path: clonePath.trim() } : {}) })
      if (done.status !== 200) return void toast.error(String((done.body as { error?: unknown } | null)?.error ?? done.status))
      toast.success(t('devices.projectAdded', { name: r.name }))
      setAdding(false)
      setCloneUrl('')
      setClonePath('')
      readProjects()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCloning(false)
    }
  }
  const unpair = async (): Promise<void> => {
    const ok = await confirmModal({ title: t('devices.unpair.title'), body: t('devices.unpair.body', { name: r.name }), confirmLabel: t('devices.unpair.button'), danger: true })
    if (!ok) return
    const done = await window.api.remote.remove(runtimeId)
    if (!done.ok) toast.error(failureLine(done, t as never))
    refreshDevices()
    onChanged()
    if (done.ok) onClose()
  }
  const readOnly = r.permission === 'read-only'

  return (
    <div className="view-doc devices-detail">
      <h1 className="devices-detail__title">{r.name}</h1>
      <SettingItem
        title={t('devices.detail.status')}
        hint={
          ping?.line ??
          (r.lastSeenAt ? t('devices.detail.lastSeen', { at: new Date(r.lastSeenAt).toLocaleString() }) : t('devices.detail.neverSeen'))
        }
        control={
          <>
            <Chip tone={STATE_TONE[state]} dot>
              {t(`devices.state.${state}`)}
            </Chip>
            <Button size="sm" variant="ghost" loading={pinging} disabled={pinging} onClick={() => void check()}>
              {t('devices.detail.check')}
            </Button>
          </>
        }
      />
      <SettingItem title={t('devices.detail.address')} hint={[`${r.address}:${r.port}`, ping?.os].filter(Boolean).join(' · ')} />
      <SettingItem title={t('devices.detail.permission')} hint={t(readOnly ? 'devices.permission.readOnly' : 'devices.permission.fullControl')} />
      <SettingItem
        title={t('devices.detail.accounts')}
        hint={accounts === undefined ? t('devices.loading') : accounts === null ? t('devices.detail.accountsUnknown') : accounts.length === 0 ? t('devices.detail.noAccounts') : undefined}
        control={
          <Button size="sm" onClick={() => void signIn(r)}>
            {t('devices.signIn')}
          </Button>
        }
      >
        {accounts && accounts.length > 0 && (
          <ul className="devices-list">
            {accounts.map((a: DeviceAccount) => (
              <li key={a.id}>
                <span>{a.label}</span>
                <span className="devices-dim">{a.provider}</span>
                <Chip tone={a.signedIn === false ? 'warn' : 'ok'} dot>
                  {t(a.signedIn === false ? 'devices.account.needsSignIn' : 'devices.account.signedIn')}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </SettingItem>
      <SettingItem
        title={t('devices.detail.projects')}
        hint={
          readOnly
            ? t('devices.needsFullControl')
            : projects === undefined
              ? t('devices.loading')
              : projects === null
                ? t('devices.detail.projectsUnknown')
                : projects.length === 0
                  ? t('devices.detail.noProjects')
                  : undefined
        }
        control={
          <Button size="sm" disabled={readOnly} aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            {t('devices.addProject')}
          </Button>
        }
      >
        {projects && projects.some((x) => x.path) && (
          <ul className="devices-list">
            {projects
              .filter((x) => x.path)
              .map((x) => (
                <li key={x.id}>
                  <span>{x.name ?? x.path}</span>
                  <span className="devices-dim devices-mono">{x.path}</span>
                </li>
              ))}
          </ul>
        )}
        {adding && (
          <div className="devices-row">
            <Input className="devices-grow" aria-label={t('devices.cloneUrl')} placeholder={t('devices.cloneUrl')} value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} spellCheck={false} />
            <Input aria-label={t('devices.clonePath')} placeholder={t('devices.clonePath')} value={clonePath} onChange={(e) => setClonePath(e.target.value)} spellCheck={false} />
            <Button size="sm" variant="primary" loading={cloning} disabled={cloning || cloneUrl.trim() === ''} onClick={() => void addProject()}>
              {t('devices.addProjectButton')}
            </Button>
          </div>
        )}
      </SettingItem>
      <SettingItem title={t('devices.detail.actions')}>
        <div className="devices-row">
          <Button size="sm" onClick={() => onNewConsole(runtimeId)}>
            {t('devices.newConsole')}
          </Button>
          {migratable.includes(runtimeId) && (
            <Button size="sm" aria-expanded={migrating} onClick={() => setMigrating((v) => !v)}>
              {t('devices.migrate.again')}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => void unpair()}>
            {t('devices.unpair.button')}
          </Button>
        </div>
        {migrating && <MigratePanel runtimeId={runtimeId} />}
      </SettingItem>
    </div>
  )
}
