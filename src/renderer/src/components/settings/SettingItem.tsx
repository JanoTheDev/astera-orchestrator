// DESIGN-W13 §12: the one settings row. Title (bold 13px) and a one-line description on the left, the control on the right;
// anything else the row needs (extra hints, a table) goes in `children` under both.
export function SettingItem({
  title,
  hint,
  control,
  children
}: {
  title: React.ReactNode
  hint?: React.ReactNode
  control?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="setting-item">
      <div className="setting-item__text">
        <span className="setting-item__title">{title}</span>
        {hint && <p className="setting-item__desc">{hint}</p>}
      </div>
      {control && <div className="setting-item__control">{control}</div>}
      {children && <div className="setting-item__extra">{children}</div>}
    </div>
  )
}
