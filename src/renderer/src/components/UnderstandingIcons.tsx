import type { MessageKey } from '../../../core/i18n'
import type { RecordStatus } from '../../../core/understanding/types'
import { Icon, type IconName } from './ui'

/** Character form of each status — kept only for the tab strip (PaneGrid → WorkbenchTabs), which draws a glyph
 *  character in its own tab dot. This screen draws RECORD_ICON instead. Shape carries the status; colour only supports it (design §7). */
export const RECORD_GLYPH: Record<RecordStatus, string> = {
  generating: '◐',
  ready: '✓',
  'needs-review': '⚠',
  failed: '!'
}

export const RECORD_GLYPH_COLOR: Record<RecordStatus, string> = {
  generating: 'var(--accent)',
  ready: 'var(--ok)',
  'needs-review': 'var(--warn)',
  failed: 'var(--danger)'
}

export const RECORD_STATUS_KEY: Record<RecordStatus, MessageKey> = {
  generating: 'hiw.record.generating',
  ready: 'hiw.record.ready',
  'needs-review': 'hiw.record.needsReview',
  failed: 'hiw.record.failed'
}

/** The icon of each status on this screen (the registry's, not a character). Shape differs per status; the
 *  word beside it is the second cue. */
export const RECORD_ICON: Record<RecordStatus, IconName> = {
  generating: 'loading',
  ready: 'done',
  'needs-review': 'warning',
  failed: 'error'
}

/** Spins while the write-up is running. The rotation is applied to the icon alone —
 *  styles.css's .hiw-spin comment says why. */
export function StatusGlyph({ status, spinning }: { status: RecordStatus; spinning: boolean }): React.JSX.Element {
  const icon = <Icon name={RECORD_ICON[status]} size={14} />
  return spinning ? <span className="hiw-spin">{icon}</span> : icon
}
