// W2-C plan overview, under the plan's Goal since T8 (its progress moved to the header): what was picked, decided and
// left out for this plan.
import type { JobRow } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'

type Decided = Pick<JobRow, 'pick' | 'decisions' | 'leftOut'>

/** #119 "Picked for this plan" (the issues Let Astera pick took or left out), #117 "Decided for you" (what the
 *  hands-off plan answered in the owner's place) and T7 "Left out of the plan" (objective items the planner skipped, and
 *  why). Each is hidden when empty. */
export function PlanDecided({ pick, decisions, leftOut }: Decided): React.JSX.Element | null {
  const { t } = useI18n()
  const picked = pick?.picked ?? []
  const skipped = pick?.skipped ?? []
  if (picked.length === 0 && skipped.length === 0 && !decisions?.length && !leftOut?.length) return null
  return (
    <div className="plan-decided">
      {leftOut && leftOut.length > 0 && (
        <section>
          <h3>{t('plan.leftOut.title')}</h3>
          <ul>
            {leftOut.map((l) => (
              <li key={l.item} className="plan-decided-skipped">{t('plan.leftOut.item', { n: l.item, text: l.text, reason: l.reason })}</li>
            ))}
          </ul>
        </section>
      )}
      {(picked.length > 0 || skipped.length > 0) && (
        <section>
          <h3>{t('plan.pick.title')}</h3>
          <ul>
            {picked.map((i) => (
              <li key={`p${i.number}`}>{t('plan.pick.picked', { n: i.number, title: i.title, why: i.why })}</li>
            ))}
            {skipped.map((i) => (
              <li key={`s${i.number}`} className="plan-decided-skipped">{t('plan.pick.skipped', { n: i.number, title: i.title, why: i.why })}</li>
            ))}
          </ul>
        </section>
      )}
      {decisions && decisions.length > 0 && (
        <section>
          <h3>{t('plan.decisions.title')}</h3>
          <ul>
            {decisions.map((d) => (
              <li key={`${d.at}${d.question}`}>
                <strong>{t(`plan.decisions.kind.${d.kind}` as const)}</strong> {d.question} → {d.choice}
                <span className="plan-decided-why"> {d.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
