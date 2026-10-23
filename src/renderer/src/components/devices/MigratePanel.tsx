// Bring my setup (T12c): what moves to a paired device (the plan; no secret is read), each kind pre-checked, then the
// copy with each item's result live from the progress stream. The Add device modal's third step, and a device tab's
// Copy my setup again.
import { useEffect, useState } from 'react'
import type { MigrateItemResult, MigrateKind, MigratePlanItem } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { Button, Checkbox, Chip } from '../ui'

const KINDS: MigrateKind[] = ['github', 'git', 'accounts', 'projects']
const STATE_TONE = { running: 'neutral', ok: 'ok', login: 'warn', skipped: 'neutral', failed: 'danger' } as const

export function MigratePanel({ runtimeId, onFinished }: { runtimeId: string; onFinished?: (ok: boolean) => void }): React.JSX.Element {
  const { t } = useI18n()
  const [on, setOn] = useState<Record<MigrateKind, boolean>>({ github: true, git: true, accounts: true, projects: true })
  const [plan, setPlan] = useState<MigratePlanItem[] | null>(null)
  const [results, setResults] = useState<MigrateItemResult[]>([])
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const only = KINDS.filter((k) => on[k])

  // The plan of every kind, read once: unchecking a kind only leaves it out of the copy.
  useEffect(() => {
    void window.api.remote.migratePlan(runtimeId, { only: KINDS }).then(
      (r) => (r.ok ? setPlan(r.plan) : (setPlan([]), toast.error(r.message))),
      (err) => (setPlan([]), toast.error(err instanceof Error ? err.message : String(err)))
    )
  }, [runtimeId])
  // The latest line per kind + id, for this device only.
  useEffect(
    () =>
      window.api.remote.onMigrateProgress((p) => {
        if (p.runtimeId !== runtimeId) return
        setResults((cur) => [...cur.filter((x) => x.kind !== p.kind || x.id !== p.id), p])
      }),
    [runtimeId]
  )
  const copy = async (): Promise<void> => {
    setBusy(true)
    setResults([])
    try {
      const r = await window.api.remote.migrate(runtimeId, { only })
      if (r.results.length > 0) setResults(r.results)
      if (!r.ok) toast.error(r.message)
      setCopied(true)
      onFinished?.(r.ok)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="devices-migrate">
      <p className="devices-hint">{t('devices.migrate.hint')}</p>
      {results.length === 0 && (
        <ul className="devices-migrate__kinds" aria-label={t('devices.migrate.planTitle')}>
          {KINDS.map((k) => {
            const items = (plan ?? []).filter((i) => i.kind === k)
            return (
              <li key={k}>
                <Checkbox label={t(`devices.migrate.${k}`)} checked={on[k]} disabled={busy} onChange={(v) => setOn((cur) => ({ ...cur, [k]: v }))} />
                {plan === null ? (
                  <p className="devices-hint">{t('devices.loading')}</p>
                ) : items.length === 0 ? (
                  <p className="devices-hint">{t('devices.migrate.none')}</p>
                ) : (
                  <ul className="devices-migrate__items">
                    {items.map((i) => (
                      <li key={`${i.kind}:${i.id}`} className={i.skip ? 'is-skipped' : undefined}>
                        {i.label}
                        {i.detail && <span className="devices-dim"> · {i.detail}</span>}
                        {i.skip && <em> · {t('devices.migrate.skipped', { reason: i.skip })}</em>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {only.length === 0 && <p className="devices-hint">{t('devices.migrate.nothing')}</p>}
      {!copied && (
        <div>
          <Button variant="primary" loading={busy} disabled={busy || only.length === 0 || plan === null} onClick={() => void copy()}>
            {t('devices.migrate.copy')}
          </Button>
        </div>
      )}
      <ul aria-live="polite" aria-label={t('devices.migrate.resultsTitle')} className="devices-migrate__items">
        {results.map((i) => (
          <li key={`${i.kind}:${i.id}`}>
            <Chip tone={STATE_TONE[i.state]} dot>
              {t(`devices.migrate.state.${i.state}`)}
            </Chip>{' '}
            {i.line}
            {i.fix && <span className="devices-hint"> · {t('devices.migrate.fix', { fix: i.fix })}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
