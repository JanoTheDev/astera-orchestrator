import type { MessageKey } from '../i18n'
import type { CloseReason } from '../types'

export interface ExitWording {
  key: MessageKey
  params?: { code: string } | { reason: string }
  /** 'danger' only for a real failure. A normal close reads muted, so it does not look like a crash. */
  tone: 'muted' | 'danger'
}

/** Plain words for a finished process's exit code. Every place that shows one uses this, so the same
 *  code never reads two ways. 129 is SIGHUP: the Host hangs up the tab once the agent is done, which is
 *  a normal close, not a crash. 143 (SIGTERM) is a normal close only when Astera closed the tab itself (`closedByAstera`).
 *  When Astera closed it and said why (`closeReason`), the muted wording names the reason.
 */
const REASON_KEY: Record<Exclude<CloseReason, `closed:${string}`>, MessageKey> = {
  released: 'exit.releasedByAstera',
  stopped: 'exit.stoppedByAstera',
  replaced: 'exit.replacedByAstera'
}

/** The muted wording for a close Astera said the reason of. T8: `closed:<text>` (`sessions close --reason`) names the text. */
const reasonWording = (r: CloseReason): ExitWording =>
  r.startsWith('closed:')
    ? { key: 'exit.closedOnRequest', params: { reason: r.slice('closed:'.length) }, tone: 'muted' }
    : { key: REASON_KEY[r as keyof typeof REASON_KEY], tone: 'muted' }

export function exitWording(
  code: number | null | undefined,
  o: { closedByAstera?: boolean; closeReason?: CloseReason } = {}
): ExitWording {
  if (code === 0) return { key: 'exit.finished', tone: 'muted' }
  if (code === 129 || (code === 143 && o.closedByAstera === true)) {
    return o.closeReason ? reasonWording(o.closeReason) : { key: 'exit.closedByAstera', tone: 'muted' }
  }
  if (code === 130) return { key: 'exit.stopped', tone: 'muted' }
  if (code === 137) return { key: 'exit.killed', tone: 'danger' }
  return { key: 'exit.failed', params: { code: code == null ? '?' : String(code) }, tone: 'danger' }
}
