import { useCallback, useEffect, useState } from 'react'
import type { AddMachineResult, MachineProgress, MigrateItemResult, MigrateKind, MigratePlanItem, RemoteApi, RemoteRuntimeInfo } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { confirmModal } from '../lib/confirm'
import { refOf, remoteCall, type RemoteSessionRef, type RemoteSessionRow } from '../lib/remoteSessions'
import { Button, Card, Chip, Field, Modal, Select } from './ui'
import { MachineSteps } from './MachineSteps'
import { addressLabel, controlFailureLine, failureLine, pairedStateLine, pairingLeftLine, pairingState, pingLine, thisMachineLine } from './remoteRuntimesText'

type ThisMachine = Awaited<ReturnType<RemoteApi['thisMachine']>>
type Choice = Awaited<ReturnType<RemoteApi['addresses']>>[number]
/** A pairing string this screen made: shown while its code is live, then what became of it (pairingState). */
type Made = { pairing: string; expiresAt: string; permission: string; pairingId?: string }
/** A machine's accounts as its `accounts-list` answers (core/accounts/accountsFile.ts orchAccountsFor). */
type MachineAccount = { id: string; label: string; provider: string; signedIn?: boolean }

/** Plain names for the platform a Runtime's ping reports; any other is shown as it came. */
const OS_NAME: Record<string, string> = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }

/** Settings › Remote Runtimes (remote runtime design Phase 6): this computer as a Runtime (turned on on one of its
 *  addresses and off, a pairing string made for a controller, a paired controller revoked: the CLI's own runtime
 *  commands, run in main), the Runtimes it is paired with, and pairing a new one from the string a Runtime made. The
 *  token stays in main. */
export function RemoteRuntimesSettings({
  onChanged,
  onNewConsole,
  onOpenSession
}: {
  /** A Runtime was paired or removed: the Jobs view reads its list again. */
  onChanged?: () => void
  /** Opens the new console dialog for that Runtime (RemoteSessionsDialog). */
  onNewConsole?: (runtimeId: string) => void
  /** Opens a remote session tab (Sign in account's login terminal). */
  onOpenSession?: (ref: RemoteSessionRef) => void
} = {}): React.JSX.Element {
  const { t } = useI18n()
  const [mine, setMine] = useState<ThisMachine | undefined>(undefined)
  const [paired, setPaired] = useState<RemoteRuntimeInfo[] | null>(null)
  const [pings, setPings] = useState<Record<string, string>>({})
  const [wizard, setWizard] = useState(false)
  /** What each machine's last ping said it runs on, and its accounts (null: it could not be asked). */
  const [osOf, setOsOf] = useState<Record<string, string>>({})
  const [accountsOf, setAccountsOf] = useState<Record<string, MachineAccount[] | null>>({})
  /** The machine an Add project form is open under, and what is typed in it. */
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [cloneUrl, setCloneUrl] = useState('')
  const [clonePath, setClonePath] = useState('')
  const [cloning, setCloning] = useState(false)
  /** This computer's controls: the addresses it offers, the one chosen, a pairing being made and the one made. */
  const [choices, setChoices] = useState<Choice[]>([])
  const [listen, setListen] = useState('')
  const [switching, setSwitching] = useState(false)
  const [fullControl, setFullControl] = useState(false)
  const [pairName, setPairName] = useState('')
  const [made, setMade] = useState<Made | null>(null)
  const [now, setNow] = useState(() => Date.now())
  /** Machines with a recorded SSH address (Copy my setup again is offered on those) and the one whose panel is open. */
  const [migratable, setMigratable] = useState<string[]>([])
  const [migrateFor, setMigrateFor] = useState<string | null>(null)

  const reload = useCallback((): void => {
    // A fresh list says how each Runtime is now: an old ping's line no longer stands over it (audit UI-9).
    setPings({})
    void window.api.remote.list().then(
      (list) => {
        setPaired(list)
        for (const r of list)
          void remoteCall(r.runtimeId, 'accounts-list', {}).then(
            (a) => setAccountsOf((m) => ({ ...m, [r.runtimeId]: a.status === 200 && Array.isArray(a.body) ? (a.body as MachineAccount[]) : null })),
            () => setAccountsOf((m) => ({ ...m, [r.runtimeId]: null }))
          )
      },
      () => setPaired([])
    )
    void window.api.remote.migrationMachines().then(setMigratable, () => setMigratable([]))
    void window.api.remote.thisMachine().then(setMine, () => setMine(null))
    // The addresses are read again too: a Wi-Fi change between two visits moves them (review focus 4).
    void window.api.remote.addresses().then(
      (c) => {
        setChoices(c)
        setListen((cur) => (c.some((x) => x.address === cur) ? cur : (c[0]?.address ?? '')))
      },
      () => setChoices([])
    )
  }, [])
  useEffect(reload, [reload])

  // A pairing string's clock, and every few seconds the Host's word on its code (used, dropped by a stop from the CLI,
  // or gone with a Host restart), only while a live one is on screen. With Remote off it goes.
  const madeState = made ? pairingState(made, mine ?? null, now) : null
  useEffect(() => {
    if (madeState !== 'live') return
    let tick = 0
    const timer = setInterval(() => {
      setNow(Date.now())
      if (++tick % 3 === 0) void window.api.remote.thisMachine().then(setMine, () => setMine(null))
    }, 1000)
    return () => clearInterval(timer)
  }, [madeState])
  useEffect(() => {
    if (madeState === 'gone') setMade(null)
  }, [madeState])

  /** One control at a time from this screen; main runs them one at a time as well. */
  const control = async (work: () => Promise<void>): Promise<void> => {
    if (switching) return
    setSwitching(true)
    try {
      await work()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSwitching(false)
      reload()
    }
  }
  const turnOn = (): Promise<void> =>
    control(async () => {
      const r = await window.api.remote.start(listen)
      if (!r.ok) return void toast.error(controlFailureLine(r, 'start', t as never))
      toast.success(t('settings.remote.start.done', { listen: String(r.body.listen ?? listen), port: String(r.body.port ?? '') }))
    })
  const turnOff = async (): Promise<void> => {
    const ok = await confirmModal({ title: t('settings.remote.stop.title'), body: t('settings.remote.stop.body'), confirmLabel: t('settings.remote.stop.button'), danger: true })
    if (!ok) return
    await control(async () => {
      const r = await window.api.remote.stop()
      if (!r.ok) return void toast.error(controlFailureLine(r, 'stop', t as never))
      setMade(null)
      toast.success(t('settings.remote.stop.done'))
    })
  }
  const makePairing = (): Promise<void> =>
    control(async () => {
      const r = await window.api.remote.pair({ fullControl, ...(pairName.trim() ? { name: pairName.trim() } : {}) })
      if (!r.ok) return void toast.error(controlFailureLine(r, 'pair', t as never))
      setNow(Date.now())
      setMade({
        pairing: String(r.body.pairing),
        expiresAt: String(r.body.expiresAt),
        permission: String(r.body.permission),
        ...(typeof r.body.pairingId === 'string' ? { pairingId: r.body.pairingId } : {})
      })
      setPairName('')
      // The next string starts from read-only again: full control is chosen for one controller at a time (minor 8).
      setFullControl(false)
    })
  const copyPairing = (): void => {
    if (!made) return
    window.api.clipboard.writeText(made.pairing)
    toast.success(t('settings.remote.newPair.copied'))
  }
  const revoke = async (c: { clientId: string; name: string }): Promise<void> => {
    const ok = await confirmModal({ title: t('settings.remote.revoke.title'), body: t('settings.remote.revoke.body', { name: c.name }), confirmLabel: t('settings.remote.revoke.button'), danger: true })
    if (!ok) return
    await control(async () => {
      const r = await window.api.remote.revoke(c.clientId)
      if (!r.ok) return void toast.error(controlFailureLine(r, 'revoke', t as never))
      toast.success(t('settings.remote.revoke.done', { name: c.name }))
    })
  }
  const remoteOn = !!mine && (mine.gateway as { state: string }).state !== 'disabled'
  /** A pairing string is made only on a Gateway that listens: one that failed would hand out an address nothing serves. */
  const gatewayState = mine ? String((mine.gateway as { state: string }).state) : ''

  const ping = async (id: string): Promise<void> => {
    if (pinging.has(id)) return
    setPinging((s) => new Set(s).add(id))
    try {
      const r = await window.api.remote.ping(id)
      reload()
      const platform = r.ok ? r.hello?.platform : undefined
      if (platform) setOsOf((m) => ({ ...m, [id]: OS_NAME[platform] ?? platform }))
      setPings((p) => ({ ...p, [id]: pingLine(r, t as never) }))
    } catch (err) {
      // Said, not left unhandled (audit UI-9).
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setPinging((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }
  /** Runtimes with a ping in flight (audit UI-9). */
  const [pinging, setPinging] = useState<Set<string>>(new Set())
  const remove = async (r: RemoteRuntimeInfo): Promise<void> => {
    const ok = await confirmModal({
      title: t('settings.remote.paired.remove'),
      body: t('settings.remote.paired.removeConfirm', { name: r.name }),
      confirmLabel: t('settings.remote.paired.remove'),
      danger: true
    })
    if (!ok) return
    const done = await window.api.remote.remove(r.runtimeId)
    if (!done.ok) toast.error(failureLine(done, t as never))
    reload()
    onChanged?.()
  }
  const addProject = async (r: RemoteRuntimeInfo): Promise<void> => {
    setCloning(true)
    try {
      const done = await remoteCall(r.runtimeId, 'projects-add', { clone: cloneUrl.trim(), ...(clonePath.trim() ? { path: clonePath.trim() } : {}) })
      if (done.status !== 200) {
        toast.error(String((done.body as { error?: unknown } | null)?.error ?? done.status))
        return
      }
      toast.success(t('remote.machines.projectAdded', { name: r.name }))
      setAddingFor(null)
      setCloneUrl('')
      setClonePath('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCloning(false)
    }
  }
  // A terminal on the machine running `astera accounts login --new` (host/loginTerminal.ts), opened as a remote session
  // tab so its login link shows here. A machine too old to open one gets the command to run there instead.
  const signIn = async (r: RemoteRuntimeInfo): Promise<void> => {
    try {
      const done = await remoteCall(r.runtimeId, 'accounts-login-start', {})
      if (done.status === 200 && onOpenSession) return onOpenSession(refOf(r.runtimeId, done.body as RemoteSessionRow))
    } catch {
      /* the copy below is the way left */
    }
    window.api.clipboard.writeText('astera accounts login --new')
    toast.success(t('remote.machines.signInCopied', { name: r.name }))
  }
  const accountsLine = (list: MachineAccount[] | null | undefined): string | null => {
    if (list === undefined || list === null) return null
    if (list.length === 0) return t('remote.machines.noAccounts')
    const names = list.map((a) => (a.signedIn === false ? `${a.label} (${t('remote.machines.signedOut')})` : a.label)).join(', ')
    return t('remote.machines.accounts', { list: names })
  }

  return (
    <div className="settings-stack">
      <p className="settings-hint">{t('settings.remote.hint')}</p>

      <div className="settings-group">
        <div className="settings-field-label">{t('settings.remote.thisMachine.title')}</div>
        {mine !== undefined && <p className="settings-hint">{thisMachineLine(mine, t as never)}</p>}
        {mine && (mine.gateway as { fingerprint?: string }).fingerprint && (
          <p className="settings-hint">{t('settings.remote.thisMachine.fingerprint', { fingerprint: String((mine.gateway as { fingerprint?: string }).fingerprint) })}</p>
        )}
        {/* Off: an address of this computer to listen on, and on. On: off, a pairing string, and the controllers. With
            the Host unable to say (mine null), nothing is offered: the answer would be a guess. */}
        {mine && !remoteOn && (
          <>
            <div className="settings-row">
              <span>{t('settings.remote.start.address')}</span>
              <Select
                className="settings-gen-select"
                ariaLabel={t('settings.remote.start.address')}
                value={listen}
                onChange={setListen}
                items={choices.map((c) => ({ value: c.address, label: addressLabel(c, t as never) }))}
              />
            </div>
            <span className="settings-hint">{t('settings.remote.start.hint')}</span>
            <div className="remote-actions is-end">
              <Button variant="primary" disabled={switching || listen === ''} onClick={() => void turnOn()}>
                {t('settings.remote.start.button')}
              </Button>
            </div>
          </>
        )}
        {mine && remoteOn && (
          <>
            <div className="remote-actions is-end">
              <Button variant="danger" size="sm" disabled={switching} onClick={() => void turnOff()}>
                {t('settings.remote.stop.button')}
              </Button>
            </div>

            <div className="settings-field-label">{t('settings.remote.newPair.title')}</div>
            <div className="remote-actions">
              <Select
                className="settings-gen-select"
                ariaLabel={t('settings.remote.newPair.title')}
                value={fullControl ? 'full-control' : 'read-only'}
                onChange={(v) => setFullControl(v === 'full-control')}
                items={[
                  { value: 'read-only', label: t('settings.remote.newPair.readOnly') },
                  { value: 'full-control', label: t('settings.remote.newPair.fullControl') }
                ]}
              />
              <input
                className="settings-gen-input remote-actions-grow"
                aria-label={t('settings.remote.newPair.name')}
                placeholder={t('settings.remote.newPair.name')}
                value={pairName}
                maxLength={64}
                onChange={(e) => setPairName(e.target.value)}
              />
              <Button variant="primary" disabled={switching || gatewayState !== 'ready'} onClick={() => void makePairing()}>
                {t('settings.remote.newPair.button')}
              </Button>
            </div>
            {gatewayState !== 'ready' && <p className="settings-hint">{t('settings.remote.newPair.notReady', { state: gatewayState })}</p>}
            {fullControl && <p className="settings-hint is-warning">{t('settings.remote.newPair.fullControlWarning')}</p>}
            {made && madeState === 'expired' && <p className="settings-hint">{t('settings.remote.newPair.expired')}</p>}
            {made && madeState === 'spent' && <p className="settings-hint">{t('settings.remote.newPair.spent')}</p>}
            {made && madeState === 'live' && (
              <>
                <div className="remote-actions">
                  <input className="settings-gen-input remote-actions-grow" readOnly value={made.pairing} aria-label={t('settings.remote.newPair.title')} spellCheck={false} onFocus={(e) => e.target.select()} />
                  <Button size="sm" onClick={copyPairing}>
                    {t('settings.remote.newPair.copy')}
                  </Button>
                </div>
                <p className="settings-hint">
                  {made.permission === 'full-control' ? t('settings.remote.paired.fullControl') : t('settings.remote.paired.readOnly')} · {pairingLeftLine(made.expiresAt, now, t as never)}
                </p>
                <p className="settings-hint">{t('settings.remote.newPair.secret')}</p>
              </>
            )}
          </>
        )}
        {/* The controllers paired with this computer, on or off: a pairing outlives turning Remote off, and one lost with
            a laptop is unpaired here without turning Remote on again for it (final review I2). */}
        {mine && (
          <>
            <span className="settings-hint">{t('settings.remote.thisMachine.clients')}</span>
            {mine.clients.length === 0 ? (
              <p className="settings-hint">{t('settings.remote.thisMachine.noClients')}</p>
            ) : (
              mine.clients.map((c) => (
                <div key={c.clientId} className="settings-row">
                  <span>
                    {c.name} · {c.permission === 'read-only' ? t('settings.remote.paired.readOnly') : t('settings.remote.paired.fullControl')}
                  </span>
                  <Button variant="danger" size="sm" disabled={switching} onClick={() => void revoke(c)}>
                    {t('settings.remote.revoke.button')}
                  </Button>
                </div>
              ))
            )}
          </>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <span className="settings-field-label">{t('settings.remote.paired.title')}</span>
          <Button variant="primary" onClick={() => setWizard(true)}>
            {t('remote.machines.add')}
          </Button>
        </div>
        {paired !== null && paired.length === 0 && <p className="settings-hint">{t('settings.remote.paired.none')}</p>}
        {paired?.map((r) => (
          <div key={r.runtimeId}>
          <div className="settings-row">
            <span>
              {r.name} · {osOf[r.runtimeId] ? `${osOf[r.runtimeId]} · ` : ''}
              {r.address}:{r.port} · {r.permission === 'read-only' ? t('settings.remote.paired.readOnly') : t('settings.remote.paired.fullControl')} ·{' '}
              {r.lastSeenAt ? t('settings.remote.paired.lastSeen', { at: new Date(r.lastSeenAt).toLocaleString() }) : t('settings.remote.paired.neverSeen')}
              {pings[r.runtimeId] ? (
                <span className="settings-hint"> · {pings[r.runtimeId]}</span>
              ) : (
                pairedStateLine(r, t as never) && <span className="settings-hint"> · {pairedStateLine(r, t as never)}</span>
              )}
            </span>
            <Chip tone={r.offline === null ? 'neutral' : r.offline ? 'warn' : 'ok'} dot>
              {t(r.offline === null ? 'remote.machines.status.unknown' : r.offline ? 'remote.machines.status.offline' : 'remote.machines.status.connected')}
            </Chip>
          </div>
          {accountsLine(accountsOf[r.runtimeId]) && <p className="settings-hint">{accountsLine(accountsOf[r.runtimeId])}</p>}
          <div className="remote-actions is-end">
            <Button size="sm" onClick={() => void ping(r.runtimeId)}>
              {t('settings.remote.paired.ping')}
            </Button>
            {onNewConsole && (
              <Button size="sm" onClick={() => onNewConsole(r.runtimeId)}>
                {t('remote.machines.newConsole')}
              </Button>
            )}
            <Button
              size="sm"
              disabled={r.permission === 'read-only'}
              title={r.permission === 'read-only' ? t('remote.machines.needsFullControl') : undefined}
              aria-expanded={addingFor === r.runtimeId}
              onClick={() => setAddingFor((cur) => (cur === r.runtimeId ? null : r.runtimeId))}
            >
              {t('remote.machines.addProject')}
            </Button>
            <Button size="sm" onClick={() => void signIn(r)}>
              {t('remote.machines.signIn')}
            </Button>
            {migratable.includes(r.runtimeId) && (
              <Button size="sm" aria-expanded={migrateFor === r.runtimeId} onClick={() => setMigrateFor((cur) => (cur === r.runtimeId ? null : r.runtimeId))}>
                {t('remote.machines.migrate.again')}
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={() => void remove(r)}>
              {t('settings.remote.paired.remove')}
            </Button>
          </div>
          {migrateFor === r.runtimeId && <MigratePanel runtimeId={r.runtimeId} onFinished={() => undefined} />}
          {addingFor === r.runtimeId && (
            <div className="remote-actions">
              <input
                className="settings-gen-input remote-actions-grow"
                aria-label={t('remote.machines.cloneUrl')}
                placeholder={t('remote.machines.cloneUrl')}
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                spellCheck={false}
              />
              <input
                className="settings-gen-input"
                aria-label={t('remote.machines.clonePath')}
                placeholder={t('remote.machines.clonePath')}
                value={clonePath}
                onChange={(e) => setClonePath(e.target.value)}
                spellCheck={false}
              />
              <Button variant="secondary" size="sm" disabled={cloning || cloneUrl.trim() === ''} onClick={() => void addProject(r)}>
                {t('remote.machines.addProjectButton')}
              </Button>
            </div>
          )}
          </div>
        ))}
      </div>

      {wizard && (
        <AddMachineModal
          onClose={() => setWizard(false)}
          onPaired={() => {
            reload()
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}

/** Add a machine: over SSH in one step (`astera machines add`, run in main, its steps streamed here), or from a
 *  pairing string the machine already printed. */
function AddMachineModal({ onClose, onPaired }: { onClose: () => void; onPaired: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [mode, setMode] = useState<'choose' | 'ssh' | 'pairing'>('choose')
  const [target, setTarget] = useState('')
  const [port, setPort] = useState('')
  const [installer, setInstaller] = useState('')
  const [name, setName] = useState('')
  const [fullControl, setFullControl] = useState(false)
  const [pairing, setPairing] = useState('')
  const [busy, setBusy] = useState(false)
  const [events, setEvents] = useState<MachineProgress[] | null>(null)
  const [result, setResult] = useState<AddMachineResult | null>(null)
  const [migrated, setMigrated] = useState(false)

  useEffect(() => window.api.remote.onMachineProgress((p) => setEvents((cur) => [...(cur ?? []), p])), [])

  const portOk = port.trim() === '' || /^\d{1,5}$/.test(port.trim())
  const startSsh = async (): Promise<void> => {
    setBusy(true)
    setEvents([])
    setResult(null)
    try {
      const r = await window.api.remote.addMachine({
        target: target.trim(),
        ...(port.trim() ? { port: Number(port.trim()) } : {}),
        ...(installer ? { installer } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        fullControl
      })
      setResult(r)
      if (r.ok) {
        toast.success(t('remote.machines.done', { name: r.name }))
        onPaired()
      } else
        // The failed step's own event may not have come: the answer carries the same failure.
        setEvents((cur) =>
          (cur ?? []).some((e) => e.state === 'failed') ? cur : [...(cur ?? []), { step: r.step, state: 'failed', line: r.message, stderrTail: r.stderrTail, fix: r.fix }]
        )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const pickInstaller = async (): Promise<void> => {
    const f = await window.api.system.pickFile()
    if (f) setInstaller(f)
  }
  const pair = async (): Promise<void> => {
    setBusy(true)
    try {
      const done = await window.api.remote.add(pairing.trim(), name.trim() || undefined)
      if (!done.ok) {
        toast.error(failureLine(done, t as never))
        return
      }
      toast.success(t('settings.remote.pair.done', { name: String(done.runtime.name ?? done.runtime.runtimeId) }))
      onPaired()
      onClose()
    } catch (err) {
      // Said, not left unhandled (audit UI-9).
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const footer =
    mode === 'choose' ? (
      <Button onClick={onClose}>{t('common.cancel')}</Button>
    ) : (
      <>
        <Button disabled={busy} onClick={() => {
            setMode('choose')
            setEvents(null)
            setResult(null)
          }}>
          {t('remote.machines.back')}
        </Button>
        {mode === 'ssh' && result?.ok ? (
          <Button variant="primary" onClick={onClose}>
            {t(migrated ? 'remote.machines.migrate.done' : 'remote.machines.migrate.skip')}
          </Button>
        ) : mode === 'ssh' ? (
          <Button variant="primary" loading={busy} disabled={busy || target.trim() === '' || !portOk} onClick={() => void startSsh()}>
            {t('remote.machines.start')}
          </Button>
        ) : (
          <Button variant="primary" loading={busy} disabled={busy || !pairing.trim().startsWith('astera-pair:')} onClick={() => void pair()}>
            {t('settings.remote.pair.button')}
          </Button>
        )}
      </>
    )

  return (
    <Modal title={t('remote.machines.add')} onClose={() => !busy && onClose()} closeLabel={t('common.close')} footer={footer}>
      <div className="settings-stack">
        {mode === 'choose' && (
          <>
            <p className="settings-hint">{t('remote.machines.chooseHint')}</p>
            <Button variant="secondary" onClick={() => setMode('ssh')}>
              {t('remote.machines.viaSsh')}
            </Button>
            <p className="settings-hint">{t('remote.machines.viaSshHint')}</p>
            <Button variant="secondary" onClick={() => setMode('pairing')}>
              {t('remote.machines.viaPairing')}
            </Button>
            <p className="settings-hint">{t('remote.machines.viaPairingHint')}</p>
          </>
        )}
        {mode === 'ssh' && events === null && (
          <>
            <Field label={t('remote.machines.target')} placeholder="user@host" value={target} onChange={(e) => setTarget(e.target.value)} spellCheck={false} autoComplete="off" />
            <Field
              label={t('remote.machines.port')}
              placeholder="22"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              error={portOk ? undefined : t('remote.machines.portInvalid')}
            />
            <div className="settings-row">
              <span>
                {t('remote.machines.installer')}
                {installer && <span className="settings-hint"> · {installer}</span>}
              </span>
              <Button onClick={() => void pickInstaller()}>{t('remote.machines.pickInstaller')}</Button>
            </div>
            <p className="settings-hint">{t('remote.machines.installerHint')}</p>
            <Field label={t('remote.machines.name')} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
            <Field kind="toggle" label={t('remote.machines.fullControl')} checked={fullControl} onChange={setFullControl} />
            {fullControl && <p className="settings-hint is-warning">{t('settings.remote.newPair.fullControlWarning')}</p>}
          </>
        )}
        {mode === 'ssh' && events !== null && (
          <>
            <p className="settings-hint">{target.trim()}</p>
            <MachineSteps events={events} />
            {result?.ok && <p className="settings-hint">{t('remote.machines.done', { name: result.name })}</p>}
            {result?.ok && <MigratePanel runtimeId={result.runtimeId} onFinished={() => setMigrated(true)} />}
          </>
        )}
        {mode === 'pairing' && (
          <>
            <p className="settings-hint">{t('settings.remote.pair.hint')}</p>
            <input
              className="settings-gen-input"
              aria-label={t('settings.remote.pair.title')}
              placeholder="astera-pair:v1:…"
              value={pairing}
              onChange={(e) => setPairing(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <input
              className="settings-gen-input"
              aria-label={t('settings.remote.pair.name')}
              placeholder={t('settings.remote.pair.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        )}
      </div>
    </Modal>
  )
}

const KINDS: MigrateKind[] = ['github', 'git', 'accounts', 'projects']
const STATE_TONE = { running: 'neutral', ok: 'ok', login: 'warn', skipped: 'neutral', failed: 'danger' } as const

/** Bring my setup: what moves to a paired machine (plan, no secrets read), then the copy with each item's result
 *  live from the progress stream. Used by the Add a machine wizard and by a paired machine's row. */
function MigratePanel({ runtimeId, onFinished }: { runtimeId: string; onFinished: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [on, setOn] = useState<Record<MigrateKind, boolean>>({ github: true, git: true, accounts: true, projects: true })
  const [plan, setPlan] = useState<MigratePlanItem[] | null>(null)
  const [results, setResults] = useState<MigrateItemResult[]>([])
  const [busy, setBusy] = useState(false)
  const only = KINDS.filter((k) => on[k])

  // The latest line per kind + id, for this machine only.
  useEffect(
    () =>
      window.api.remote.onMigrateProgress((p) => {
        if (p.runtimeId !== runtimeId) return
        setResults((cur) => [...cur.filter((x) => x.kind !== p.kind || x.id !== p.id), p])
      }),
    [runtimeId]
  )
  const run = async (copy: boolean): Promise<void> => {
    setBusy(true)
    try {
      if (!copy) {
        const r = await window.api.remote.migratePlan(runtimeId, { only })
        if (r.ok) setPlan(r.plan)
        else toast.error(r.message)
        return
      }
      setResults([])
      const r = await window.api.remote.migrate(runtimeId, { only })
      if (r.results.length > 0) setResults(r.results)
      if (!r.ok) toast.error(r.message)
      onFinished()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <div className="settings-stack">
        <div className="settings-field-label">{t('remote.machines.migrate.title')}</div>
        <p className="settings-hint">{t('remote.machines.migrate.hint')}</p>
        {KINDS.map((k) => (
          <Field key={k} kind="toggle" label={t(`remote.machines.migrate.${k}` as never)} checked={on[k]} disabled={busy} onChange={(v) => setOn((cur) => ({ ...cur, [k]: v }))} />
        ))}
        {only.length === 0 && <p className="settings-hint">{t('remote.machines.migrate.nothing')}</p>}
        <div className="remote-actions">
          <Button disabled={busy || only.length === 0} onClick={() => void run(false)}>
            {t('remote.machines.migrate.show')}
          </Button>
          <Button variant="primary" loading={busy} disabled={busy || only.length === 0} onClick={() => void run(true)}>
            {t('remote.machines.migrate.copy')}
          </Button>
        </div>
        {plan !== null && results.length === 0 && (
          <ul aria-label={t('remote.machines.migrate.planTitle')} className="settings-stack">
            {plan.map((i) => (
              <li key={`${i.kind}:${i.id}`} className={i.skip ? 'settings-hint' : undefined}>
                {i.label}
                {i.detail && ` · ${i.detail}`}
                {i.skip && <em> · {t('remote.machines.migrate.skipped', { reason: i.skip })}</em>}
              </li>
            ))}
          </ul>
        )}
        <ul aria-live="polite" aria-label={t('remote.machines.migrate.resultsTitle')} className="settings-stack">
          {results.map((i) => (
            <li key={`${i.kind}:${i.id}`}>
              <Chip tone={STATE_TONE[i.state]} dot>
                {t(`remote.machines.migrate.state.${i.state}` as never)}
              </Chip>{' '}
              {i.line}
              {i.fix && <span className="settings-hint"> · {t('remote.machines.migrate.fix', { fix: i.fix })}</span>}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
