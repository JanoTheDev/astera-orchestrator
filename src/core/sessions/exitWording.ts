import type { MessageKey } from '../i18n'

export interface ExitWording {
  key: MessageKey
  params?: { code: string }
  /** 'danger' only for a real failure. A normal close reads muted, so it does not look like a crash. */
  tone: 'muted' | 'danger'
}

/** Plain words for a finished process's exit code. Every place that shows one uses this, so the same
 *  code never reads two ways. 129 is SIGHUP: the Host hangs up the tab once the agent is done, which is
 *  a normal close, not a crash. 143 (SIGTERM) is a normal close only when Astera closed the tab itself.
 *  shortcut: no close-reason is carried to the renderer yet, so callers pass no `closedByAstera` and a
 *  143 reads as Failed; upgrade by threading the flag from the session kill path. */
export function exitWording(code: number | null | undefined, o: { closedByAstera?: boolean } = {}): ExitWording {
  if (code === 0) return { key: 'exit.finished', tone: 'muted' }
  if (code === 129 || (code === 143 && o.closedByAstera === true)) return { key: 'exit.closedByAstera', tone: 'muted' }
  if (code === 130) return { key: 'exit.stopped', tone: 'muted' }
  if (code === 137) return { key: 'exit.killed', tone: 'danger' }
  return { key: 'exit.failed', params: { code: code == null ? '?' : String(code) }, tone: 'danger' }
}
