import type { TaskStatus } from '../../../../core/types'
import type { ChipTone } from './Chip'

/** The one colour meaning per status. Glyphs, bands, the graph, chips and the board all read it; CSS files
 *  that colour a status use the same tokens (--info running, --fi-purple checking, --ok done, --danger
 *  failed, --warn blocked / needs you, --text-dim waiting). Task kinds never use these (planBoard.css). */
export type StatusMeaning = 'waiting' | 'running' | 'checking' | 'done' | 'failed' | 'blocked'

export const MEANING_COLOR: Record<StatusMeaning, string> = {
  waiting: 'var(--text-dim)',
  running: 'var(--info)',
  checking: 'var(--fi-purple)',
  done: 'var(--ok)',
  failed: 'var(--danger)',
  blocked: 'var(--warn)'
}

// shortcut: Chip has no purple tone, so checking is a neutral chip; its glyph keeps the purple
export const MEANING_CHIP: Record<StatusMeaning, ChipTone> = {
  waiting: 'neutral',
  running: 'info',
  checking: 'neutral',
  done: 'ok',
  failed: 'danger',
  blocked: 'warn'
}

export const TASK_MEANING: Record<TaskStatus, StatusMeaning> = {
  pending: 'waiting',
  ready: 'waiting',
  dispatched: 'running',
  validating: 'checking',
  reviewing: 'checking',
  merging: 'checking',
  completed: 'done',
  failed: 'failed',
  blocked: 'blocked'
}

/** Not-started Tasks keep the dimmer --fi-mute so pending reads fainter than ready. */
export const taskStatusColor = (s: TaskStatus): string =>
  s === 'pending' ? 'var(--fi-mute)' : MEANING_COLOR[TASK_MEANING[s]]

export const taskStatusTone = (s: TaskStatus): ChipTone => MEANING_CHIP[TASK_MEANING[s]]
