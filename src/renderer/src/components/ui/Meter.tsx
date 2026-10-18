import { clampPercent, cx, meterTone } from './logic'

/** A 0–100 usage bar coloured by the usage-guard thresholds. */
export function Meter({ value, label, className }: { value: number; label?: string; className?: string }): React.JSX.Element {
  const v = clampPercent(value)
  return (
    <div className={cx('ui-meter', `ui-meter--${meterTone(v)}`, className)}>
      {label && <span className="ui-meter__label">{label}</span>}
      <div className="ui-meter__track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
        <div className="ui-meter__fill" style={{ width: `${v}%` }} />
      </div>
    </div>
  )
}
