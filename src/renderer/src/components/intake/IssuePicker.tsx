// #119: the GitHub issue picker of the Start page and the New plan dialog: search, the assignee filter, Select all, the
// list, and "Let Astera pick". The state is useIntake's.
import { Sparkles } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Field } from '../ui'
import { allSelected, ASSIGNEE_FILTERS, toggleAll } from './intakeRequest'
import type { Intake } from './useIntake'

export function IssuePicker({ intake, onAutoPick }: { intake: Intake; onAutoPick: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const { issues, picked, setPicked } = intake
  const pick = (id: string, on: boolean): void => setPicked((cur) => (on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id)))
  return (
    <div className="start-issues">
      <Field label={t('intake.search')} value={intake.query} onChange={(e) => intake.setQuery(e.target.value)} placeholder={t('intake.search')} />
      <Field
        kind="select"
        label={t('intake.assignee')}
        value={intake.assignee}
        onChange={(e) => intake.setAssignee(e.target.value as (typeof ASSIGNEE_FILTERS)[number])}
        options={ASSIGNEE_FILTERS.map((a) => ({ value: a, label: t(`intake.assignee.${a}` as const) }))}
      />
      <label className="check-small">
        <input type="checkbox" checked={allSelected(issues, picked)} disabled={issues.every((i) => i.selectable === false)} onChange={() => setPicked((cur) => toggleAll(issues, cur))} />
        {t('intake.selectAll')}
      </label>
      <div className="start-issue-list">
        {issues.map((i) => (
          <label key={i.id} className="check-small" title={i.reason}>
            <input type="checkbox" disabled={i.selectable === false} checked={picked.includes(i.id)} onChange={(e) => pick(i.id, e.target.checked)} />#{i.id} {i.title}
          </label>
        ))}
      </div>
      <Field kind="toggle" label={t('intake.assignMe')} checked={intake.assignMe} onChange={intake.setAssignMe} />
      <div className="start-auto">
        <Field label={t('start.issues.autoLabel')} value={intake.autoLabel} onChange={(e) => intake.setAutoLabel(e.target.value)} placeholder="bug" />
        <Field kind="number" label={t('start.issues.autoMax')} min={1} value={intake.autoMax} onChange={(e) => intake.setAutoMax(e.target.value)} />
        <Button icon={<Sparkles size={14} aria-hidden="true" />} loading={intake.busy} disabled={intake.busy} onClick={onAutoPick}>
          {t('start.issues.auto')}
        </Button>
      </div>
      <p className="start-auto-hint">{t('start.issues.autoHint')}</p>
      {intake.skipped.length > 0 && (
        <ul className="start-auto-skipped">
          {intake.skipped.map((s) => (
            <li key={s.number}>{t('start.issues.autoSkipped', { n: s.number, why: s.why })}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
