// One file's diff as `git diff` printed it on the machine the Run lives on (remote runtime design Phase 10): numbered
// rows, added and removed lines coloured, a cut diff and a binary file said in words. Text only: nothing here opens or
// resolves a path.
import { useMemo, useState } from 'react'
import { DIFF_ROWS_STEP, diffLines, type DiffRow } from '../lib/diffLines'
import { useI18n } from '../i18n/I18nProvider'
import { Button } from './ui'

export function DiffView({
  diff,
  truncated,
  binary,
  selected,
  onRowPick
}: {
  diff: string
  truncated: boolean
  binary: boolean
  /** T7 review: the rows (indexes into diffLines(diff)) drawn as selected, inclusive. */
  selected?: { from: number; to: number } | null
  /** T7 review: a press on a row; `extend` when Shift is held (a range from the last pick). */
  onRowPick?: (index: number, row: DiffRow, extend: boolean) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const rows = useMemo(() => diffLines(diff), [diff])
  const [shown, setShown] = useState(DIFF_ROWS_STEP)
  return (
    <div className="diff-view">
      {binary && <p className="modal-hint">{t('jobs.changes.binaryDiff')}</p>}
      {truncated && <p className="modal-hint">{t('jobs.changes.truncated')}</p>}
      <table className="diff-table">
        <tbody>
          {rows.slice(0, shown).map((r, i) => (
            <tr
              key={i}
              className={`diff-row diff-${r.kind}${selected && i >= selected.from && i <= selected.to ? ' is-selected' : ''}`}
              onMouseDown={onRowPick && r.kind !== 'hunk' && r.kind !== 'meta' ? (e) => (e.shiftKey && e.preventDefault(), onRowPick(i, r, e.shiftKey)) : undefined}
            >
              <td className="diff-no">{r.oldNo ?? ''}</td>
              <td className="diff-no">{r.newNo ?? ''}</td>
              <td className="diff-text">{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown && (
        <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + DIFF_ROWS_STEP)}>
          {t('jobs.changes.moreRows', { count: Math.min(DIFF_ROWS_STEP, rows.length - shown), left: rows.length - shown })}
        </Button>
      )}
    </div>
  )
}
