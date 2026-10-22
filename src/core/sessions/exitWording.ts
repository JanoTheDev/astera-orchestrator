import type { MessageKey } from '../i18n'
import type { CloseReason } from '../types'

export interface ExitWording {
  key: MessageKey
  params?: { code: string }
  /** 'danger' only for a real failure. A normal close reads muted, so it does not look like a crash. */
  tone: 'muted' | 'danger'
}

/** Plain words for a finished process's exit code. Every place that shows one uses this, so the same
 *  code never reads two ways. 129 is SIGHUP: the Host hangs up the tab once the agent is done, which is
 *  a normal close, not a crash. 143 (SIGTERM) is a normal close only when Astera closed the tab itself (`closedByAstera`).
 *  When Astera closed it and said why (`closeReason`), the muted wording names the reason.
 */
const REASON_KEY: Record<CloseReason, MessageKey> = {
  released: 'exit.releasedByAstera',
  stopped: 'exit.stoppedByAstera',
  replaced: 'exit.replacedByAstera',
  // T8: `astera sessions close`
  closed: 'exit.closedOnRequest'
}

export function exitWording(
  code: number | null | undefined,
  o: { closedByAstera?: boolean; closeReason?: CloseReason } = {}
): ExitWording {
  if (code === 0) return { key: 'exit.finished', tone: 'muted' }
  if (code === 129 || (code === 143 && o.closedByAstera === true)) {
    return { key: o.closeReason ? REASON_KEY[o.closeReason] : 'exit.closedByAstera', tone: 'muted' }
  }
  if (code === 130) return { key: 'exit.stopped', tone: 'muted' }
  if (code === 137) return { key: 'exit.killed', tone: 'danger' }
  return { key: 'exit.failed', params: { code: code == null ? '?' : String(code) }, tone: 'danger' }
}
