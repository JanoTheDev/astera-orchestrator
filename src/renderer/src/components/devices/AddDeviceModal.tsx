// Add a device, one step at a time with one primary button each: choose (a found device, an address, or a pairing
// string), connect & set up (`astera machines add` run in main, its steps streamed into MachineSteps), bring my setup,
// done. When the app cannot finish (sudo needs a password, the SSH key is not on the device) the command goes to a
// terminal instead (devicesView.ts terminalFixOf).
import { useEffect, useState } from 'react'
import type { AddMachineResult, FoundDevice, MachineProgress } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { failureLine } from '../remoteRuntimesText'
import { MachineSteps } from '../MachineSteps'
import { Button, Field, Input, Modal, Tabs } from '../ui'
import { MigratePanel } from './MigratePanel'
import { suggestedTarget, terminalFixOf } from './devicesView'

type Step = 'choose' | 'connect' | 'bring' | 'done'
type Mode = 'ssh' | 'pairing'

export function AddDeviceModal({
  found,
  initial,
  homeDir,
  onClose,
  onPaired,
  onNewConsole,
  onRunInTerminal
}: {
  /** The devices found on the network and not paired, to pick from. */
  found: FoundDevice[]
  /** The found device the modal was opened on (its row's Add). */
  initial?: FoundDevice
  homeDir: string | null
  onClose: () => void
  /** A device was paired: the lists are read again. */
  onPaired: () => void
  onNewConsole: (runtimeId: string) => void
  /** Opens a terminal running `command`. */
  onRunInTerminal: (command: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [step, setStep] = useState<Step>('choose')
  const [mode, setMode] = useState<Mode>('ssh')
  const [pick, setPick] = useState(initial?.key ?? '')
  const [target, setTarget] = useState(initial ? suggestedTarget(initial, homeDir) : '')
  const [port, setPort] = useState('')
  const [installer, setInstaller] = useState('')
  const [name, setName] = useState(initial?.name ?? '')
  const [fullControl, setFullControl] = useState(true)
  const [pairing, setPairing] = useState('')
  const [busy, setBusy] = useState(false)
  const [events, setEvents] = useState<MachineProgress[]>([])
  const [result, setResult] = useState<AddMachineResult | null>(null)
  /** The device paired, for the last two steps. */
  const [device, setDevice] = useState<{ runtimeId: string; name: string } | null>(null)
  const [migrated, setMigrated] = useState(false)

  useEffect(() => window.api.remote.onMachineProgress((p) => setEvents((cur) => [...cur, p])), [])

  const choose = (key: string): void => {
    setPick(key)
    const f = found.find((x) => x.key === key)
    if (!f) return
    setTarget(suggestedTarget(f, homeDir))
    setName(f.name)
  }
  const portOk = port.trim() === '' || /^\d{1,5}$/.test(port.trim())
  const options = { target, ...(port.trim() ? { port: Number(port.trim()) } : {}), ...(installer ? { installer } : {}), ...(name.trim() ? { name: name.trim() } : {}), fullControl }
  const fix = terminalFixOf(result, options)

  const connect = async (): Promise<void> => {
    setStep('connect')
    setBusy(true)
    setEvents([])
    setResult(null)
    try {
      const r = await window.api.remote.addMachine({ ...options, target: target.trim() })
      setResult(r)
      if (r.ok) {
        setDevice({ runtimeId: r.runtimeId, name: r.name })
        onPaired()
      } else
        // The failed step's own event may not have come: the answer carries the same failure.
        setEvents((cur) => (cur.some((e) => e.state === 'failed') ? cur : [...cur, { step: r.step, state: 'failed', line: r.message, stderrTail: r.stderrTail, fix: r.fix }]))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const pair = async (): Promise<void> => {
    setBusy(true)
    try {
      const done = await window.api.remote.add(pairing.trim(), name.trim() || undefined)
      if (!done.ok) return void toast.error(failureLine(done, t as never))
      const runtimeId = String(done.runtime.runtimeId)
      setDevice({ runtimeId, name: String(done.runtime.name ?? runtimeId) })
      onPaired()
      // A pairing string brings no SSH address, so there is no setup to copy over it
      setStep('done')
    } catch (err) {
      // Said, not left unhandled (audit UI-9).
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const pickInstaller = async (): Promise<void> => {
    const f = await window.api.system.pickFile()
    if (f) setInstaller(f)
  }
  const runInTerminal = (): void => {
    if (!fix) return
    onRunInTerminal(fix.command)
    toast.info(t('devices.add.terminalOpened'))
    onClose()
  }

  const back = (
    <Button variant="ghost" disabled={busy} onClick={() => setStep('choose')}>
      {t('devices.add.back')}
    </Button>
  )
  const footer = ((): React.ReactNode => {
    if (step === 'choose')
      return (
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {mode === 'ssh' ? (
            <Button variant="primary" disabled={target.trim() === '' || !portOk} onClick={() => void connect()}>
              {t('devices.add.connect')}
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={busy || !pairing.trim().startsWith('astera-pair:')} onClick={() => void pair()}>
              {t('devices.add.pair')}
            </Button>
          )}
        </>
      )
    if (step === 'connect')
      return (
        <>
          {!result?.ok && back}
          {result?.ok ? (
            <Button variant="primary" onClick={() => setStep('bring')}>
              {t('devices.add.next')}
            </Button>
          ) : fix ? (
            <Button variant="primary" onClick={runInTerminal}>
              {t('devices.add.runInTerminal')}
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={busy} onClick={() => void connect()}>
              {t(busy ? 'devices.add.connect' : 'devices.add.retry')}
            </Button>
          )}
        </>
      )
    if (step === 'bring')
      return (
        <Button variant={migrated ? 'primary' : 'ghost'} onClick={() => setStep('done')}>
          {t(migrated ? 'devices.add.next' : 'devices.add.skip')}
        </Button>
      )
    return (
      <>
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
        {device && (
          <Button
            variant="primary"
            onClick={() => {
              onNewConsole(device.runtimeId)
              onClose()
            }}
          >
            {t('devices.add.openConsole', { name: device.name })}
          </Button>
        )}
      </>
    )
  })()

  return (
    <Modal title={t('devices.add.title')} onClose={() => !busy && onClose()} closeLabel={t('common.close')} footer={footer}>
      <div className="devices-modal">
        <ol className="devices-modal__steps" aria-label={t('devices.add.stepsLabel')}>
          {(['choose', 'connect', 'bring', 'done'] as const).map((s) => (
            <li key={s} className={s === step ? 'is-current' : undefined} aria-current={s === step ? 'step' : undefined}>
              {t(`devices.add.step.${s}`)}
            </li>
          ))}
        </ol>
        {step === 'choose' && (
          <>
            <p className="devices-hint">{t('devices.add.supported')}</p>
            <Tabs
              label={t('devices.add.how')}
              value={mode}
              onChange={setMode}
              items={[
                { id: 'ssh', label: t('devices.add.viaSsh') },
                { id: 'pairing', label: t('devices.add.viaPairing') }
              ]}
            />
            {mode === 'ssh' ? (
              <>
                {found.length > 0 && (
                  <Field
                    kind="select"
                    label={t('devices.add.found')}
                    value={pick}
                    onChange={(e) => choose(e.target.value)}
                    options={[{ value: '', label: t('devices.add.typeAddress') }, ...found.map((f) => ({ value: f.key, label: `${f.name} · ${f.address}` }))]}
                  />
                )}
                <Field
                  label={t('devices.add.target')}
                  hint={t('devices.add.targetHint')}
                  placeholder="user@host"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <Field
                  label={t('devices.add.port')}
                  placeholder="22"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  error={portOk ? undefined : t('devices.add.portInvalid')}
                />
                <Field label={t('devices.add.name')} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
                <div className="devices-row">
                  <span>
                    {t('devices.add.installer')}
                    {installer && <span className="devices-dim"> · {installer}</span>}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void pickInstaller()}>
                    {t('devices.add.pickInstaller')}
                  </Button>
                </div>
                <Field kind="toggle" label={t('devices.add.fullControl')} hint={t('devices.add.fullControlHint')} checked={fullControl} onChange={setFullControl} />
              </>
            ) : (
              <>
                <p className="devices-hint">{t('devices.add.pairingHint')}</p>
                <Input
                  aria-label={t('devices.add.pairing')}
                  placeholder="astera-pair:v1:…"
                  value={pairing}
                  onChange={(e) => setPairing(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <Field label={t('devices.add.name')} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
              </>
            )}
          </>
        )}
        {step === 'connect' && (
          <>
            <p className="devices-hint">{target.trim()}</p>
            <MachineSteps events={events} />
            {fix && <p className="devices-hint">{t(fix.kind === 'sudo' ? 'devices.add.terminalSudo' : 'devices.add.terminalKey')}</p>}
            {fix && <pre className="devices-command">{fix.command}</pre>}
          </>
        )}
        {step === 'bring' && device && <MigratePanel runtimeId={device.runtimeId} onFinished={() => setMigrated(true)} />}
        {step === 'done' && device && <p>{t('devices.add.ready', { name: device.name })}</p>}
      </div>
    </Modal>
  )
}
