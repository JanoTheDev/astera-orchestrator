// T8 Plan settings (DESIGN-W13 §13): a running plan's workers at once, priority, review rounds, replan, auto-approve,
// hands-off and delivery, each saved on commit through `jobs-set`. Settings-editor rows: title and one help line on the
// left, the control on the right. A field the plan can no longer change is read-only and says why.
import { useEffect, useState } from 'react'
import type { JobRow } from '../../../../core/types'
import type { PlanSettingKey } from '../../../../core/orchestration/planSettings'
import { MAX_CONCURRENT_WORKERS, MAX_REVIEW_ROUNDS, type Job, type JobRun, type Project } from '../../../../core/orchestration/types'
import { useI18n } from '../../i18n/I18nProvider'
import { replyNote, type OrchDoor } from '../../lib/orchDoor'
import type { ActionUi } from '../../lib/jobActions'
import { toast } from '../../lib/toast'
import { APPROVAL_MODES, type ApprovalMode } from '../../../../core/settings/approvalDefault'
import { Input, Select, Switch } from '../ui'
import { useDeliveryChoices } from '../delivery/useDeliveryChoices'
import {
  APPROVAL_LABEL,
  approvalOf,
  clampReviewRounds,
  clampWorkers,
  planSettingsFormOf,
  priorityChoicesOf,
  settingsDiff,
  settledValues,
  SETTING_REASON_KEY,
  type PlanSettingsForm,
  type PlanSettingsValues
} from './planSettingsForm'

export function PlanSettings({ door, jobId, row, confirm }: { door: OrchDoor; jobId: string; row: JobRow | undefined; confirm: ActionUi['confirm'] }): React.JSX.Element {
  const { t } = useI18n()
  const [form, setForm] = useState<PlanSettingsForm | null>(null)
  /** The Job's own id: `jobs-set --priority` takes a Job's, never a Run's. */
  const [id, setId] = useState(jobId)
  const [saving, setSaving] = useState(false)
  /** T6: the plan's project, for the deliveries its folder is set up for (none read for a plan on another machine). */
  const [project, setProject] = useState<Project | undefined>(undefined)
  // Read again when the plan's state moves on (it finishes, its delivery starts): what can change follows it
  const outcome = row?.outcome
  const moved = `${outcome}:${row?.archivedAt ?? ''}:${row?.delivery?.state ?? ''}`
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const got = await door.command('jobs-get', { id: jobId })
      if (got.status >= 400) return
      const { run, ...job } = got.body as Job & { run?: JobRun }
      const proj = job.projectId === undefined ? undefined : await door.command('projects-get', { id: job.projectId })
      const globalDefault = (await window.api.settings.getApprovalDefault().catch(() => null)) ?? undefined
      if (cancelled) return
      setId(job.id)
      setProject(proj && proj.status < 400 ? (proj.body as Project) : undefined)
      setForm(planSettingsFormOf(job, run, proj && proj.status < 400 ? (proj.body as Project) : undefined, outcome, globalDefault))
    })().catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `moved` names what the read depends on
  }, [door, jobId, moved])

  const offered = useDeliveryChoices(door.runtimeId === undefined ? project?.path : undefined, form?.values.delivery ?? 'pr', project?.deliveryBranch)
  if (form === null) return <p className="plan-settings-loading">{t('plan.settings.loading')}</p>
  const { values, fields } = form
  const locked = door.readOnlyReason ?? undefined

  const save = async (next: PlanSettingsValues): Promise<void> => {
    const args = settingsDiff(values, next)
    if (args === null) return
    setForm({ fields, values: next })
    setSaving(true)
    let ok = false
    try {
      const reply = await door.command('jobs-set', { id, ...args })
      ok = reply.status < 400
      if (!ok) toast.error(t('plan.settings.failed', { reason: replyNote(reply, t as never, (reply.body as { error?: string } | null)?.error ?? t('jobs.node.failed')) }))
    } catch {
      toast.error(t('plan.settings.failed', { reason: t('jobs.node.failed') }))
    } finally {
      setSaving(false)
    }
    if (ok) toast.success(t('plan.settings.saved'))
    setForm((cur) => (cur === null ? cur : { ...cur, values: settledValues(values, next, ok) }))
  }
  const set2 = (mode: ApprovalMode): void => void save({ ...values, autoApprove: mode !== 'ask', handsOff: mode === 'hands-off' })
  const set = <K extends keyof PlanSettingsValues>(key: K, value: PlanSettingsValues[K]): void => void save({ ...values, [key]: value })

  /** One settings-editor row; `key` names its field's editability and the ids its label and help hang on. */
  const row_ = (
    key: PlanSettingKey,
    control: (props: { id: string; disabled: boolean; 'aria-describedby': string }) => React.ReactNode,
    /** T6: one more line under the help, e.g. why the saved delivery is not offered */
    note?: string | null
  ): React.JSX.Element => {
    const f = fields[key]
    const domId = `plan-setting-${key}`
    const disabled = !f.editable || locked !== undefined || saving
    return (
      <div className={`plan-setting${f.editable ? '' : ' plan-setting--readonly'}`} key={key}>
        <div className="plan-setting-text">
          <label className="plan-setting-title" htmlFor={domId}>
            {t(`plan.settings.${key}`)}
          </label>
          <span className="plan-setting-help" id={`${domId}-help`}>
            {t(`plan.settings.${key}Help`)}
            {f.reason !== undefined && <span className="plan-setting-why"> {t(SETTING_REASON_KEY[f.reason])}</span>}
            {note && <span className="plan-setting-why"> {note}</span>}
          </span>
        </div>
        <div className="plan-setting-control" title={locked}>
          {control({ id: domId, disabled, 'aria-describedby': `${domId}-help` })}
        </div>
      </div>
    )
  }
  /** A stepper saved on blur or Enter; what does not parse puts the saved value back. */
  const stepper = (key: 'concurrency' | 'reviewRounds', max: number, clamp: (raw: string) => number | null) =>
    row_(key, (props) => (
      <Input
        {...props}
        type="number"
        min={1}
        max={max}
        key={values[key]}
        defaultValue={values[key]}
        aria-readonly={!fields[key].editable || undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        onBlur={(e) => {
          const n = clamp(e.currentTarget.value)
          e.currentTarget.value = String(n ?? values[key])
          if (n !== null) set(key, n)
        }}
      />
    ))
  const toggle = (key: 'replan', onChange: (on: boolean) => void) =>
    row_(key, (props) => <Switch {...props} checked={values[key]} aria-readonly={!fields[key].editable || undefined} onChange={onChange} />)

  return (
    <div className="plan-settings">
      {stepper('concurrency', MAX_CONCURRENT_WORKERS, clampWorkers)}
      {row_('priority', (props) => (
        <Select
          {...props}
          aria-label={t('plan.settings.priority')}
          value={String(values.priority)}
          items={priorityChoicesOf(values.priority).map((c) => ({ value: String(c.value), label: c.key ? t(c.key) : String(c.value) }))}
          onChange={(v) => set('priority', Number(v))}
        />
      ))}
      {stepper('reviewRounds', MAX_REVIEW_ROUNDS, clampReviewRounds)}
      {toggle('replan', (on) => set('replan', on))}
      {/* One approval setting over the two stored flags. Hands-off bypasses permissions: choosing it asks first */}
      {row_('autoApprove', (props) => (
        <Select
          {...props}
          aria-label={t('plan.settings.autoApprove')}
          value={approvalOf(values)}
          items={APPROVAL_MODES.map((m) => ({ value: m, label: t(APPROVAL_LABEL[m]) }))}
          onChange={(v) => {
            const mode = APPROVAL_MODES.find((m) => m === v)
            if (mode === undefined || mode === approvalOf(values)) return
            const apply = (): void => set2(mode)
            if (mode !== 'hands-off') return apply()
            void confirm({ title: t('plan.settings.handsOffConfirmTitle'), body: t('plan.settings.handsOffConfirmBody'), confirmLabel: t('plan.settings.handsOffConfirm') }).then((yes) => yes && apply())
          }}
        />
      ))}
      {row_(
        'delivery',
        (props) => (
          <Select
            {...props}
            aria-label={t('plan.settings.delivery')}
            value={offered.mode}
            items={offered.options}
            onChange={(v) => {
              const d = offered.options.find((o) => o.value === v)?.value
              if (d !== undefined) set('delivery', d)
            }}
          />
        ),
        offered.reason
      )}
    </div>
  )
}
