// The live step list of Add a machine over SSH (T12b): one row per step of `astera machines add`, each with its state
// and the CLI's own line (plain English, shown as-is like the remote error messages). A failed step also shows the tail
// of what the machine wrote and the fix.
import type { MachineProgress, MachineStepId } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { Chip, type ChipTone } from './ui'

export const MACHINE_STEPS: MachineStepId[] = ['connect', 'detect', 'installer', 'upload', 'install', 'pair', 'verify']

const TONE: Record<MachineProgress['state'] | 'waiting', ChipTone> = { waiting: 'neutral', running: 'info', done: 'ok', skipped: 'neutral', failed: 'danger' }

export function MachineSteps({ events }: { events: MachineProgress[] }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <ol className="settings-stack machine-steps" aria-live="polite">
      {MACHINE_STEPS.map((step) => {
        const ev = [...events].reverse().find((e) => e.step === step)
        const state = ev?.state ?? 'waiting'
        return (
          <li key={step}>
            <div className="settings-row">
              <span>{t(`remote.machines.step.${step}` as never)}</span>
              <Chip tone={TONE[state]} dot>
                {t(`remote.machines.state.${state}` as never)}
              </Chip>
            </div>
            {ev?.line && <p className="settings-hint">{ev.line}</p>}
            {state === 'failed' && ev?.stderrTail && <pre className="pr-create-detail">{ev.stderrTail}</pre>}
            {state === 'failed' && ev?.fix && (
              <p className="settings-hint is-warning">
                {t('remote.machines.fix')} {ev.fix}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
