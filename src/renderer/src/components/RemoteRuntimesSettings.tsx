import { useCallback, useEffect, useState } from 'react'
import type { RemoteApi } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { useSetting } from '../hooks/useSetting'
import { confirmModal } from '../lib/confirm'
import { Button, Input, Select } from './ui'
import { openActivity } from './shell/navigation'
import { addressLabel, controlFailureLine, pairingLeftLine, pairingState, thisMachineLine } from './remoteRuntimesText'

type ThisMachine = Awaited<ReturnType<RemoteApi['thisMachine']>>
type Choice = Awaited<ReturnType<RemoteApi['addresses']>>[number]
/** A pairing string this screen made: shown while its code is live, then what became of it (pairingState). */
type Made = { pairing: string; expiresAt: string; permission: string; pairingId?: string }

const NO_CHOICES: Choice[] = []

/** Settings › Remote Runtimes (remote runtime design Phase 6): this computer as a Runtime (turned on on one of its
 *  addresses and off, a pairing string made for a controller, a paired controller revoked: the CLI's own runtime
 *  commands, run in main). The devices this computer is paired with, and adding one, are the Devices view's. The
 *  token stays in main. */
export function RemoteRuntimesSettings(): React.JSX.Element {
  const { t } = useI18n()
  const [mine, setMine] = useSetting<ThisMachine | null>('remoteThisMachine', () => window.api.remote.thisMachine().catch(() => null))
  /** This computer's controls: the addresses it offers, the one chosen, a pairing being made and the one made. */
  const [choices, setChoices] = useSetting<Choice[]>('remoteAddresses', () => window.api.remote.addresses().catch(() => []), NO_CHOICES)
  const [listen, setListen] = useState('')
  const [switching, setSwitching] = useState(false)
  const [fullControl, setFullControl] = useState(false)
  const [pairName, setPairName] = useState('')
  const [made, setMade] = useState<Made | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const reload = useCallback((): void => {
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
  useEffect(() => {
    setListen((cur) => (choices.some((x) => x.address === cur) ? cur : (choices[0]?.address ?? '')))
  }, [choices])

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
              <Input
                className="remote-actions-grow"
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
                  <Input className="remote-actions-grow" readOnly value={made.pairing} aria-label={t('settings.remote.newPair.title')} spellCheck={false} onFocus={(e) => e.target.select()} />
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
          <span className="settings-field-label">{t('settings.remote.yourDevices')}</span>
          <Button onClick={() => openActivity('devices')}>{t('settings.remote.openDevices')}</Button>
        </div>
      </div>
    </div>
  )
}
