import type { MessageKey, MessageParams } from '../i18n'

export type ExitTone = 'ok' | 'muted' | 'danger'

/** A pty exit code in plain words. 129 and 143 are SIGHUP and SIGTERM (128 + signal): the Host closing a
 *  tab once the agent is done, which reads as a crash when printed as a number. Astera does not record why
 *  it closed a pty, so both codes share one wording. Only the unknown-code case shows the number. */
export function exitStatusOf(code: number): { key: MessageKey; params?: { code: number }; tone: ExitTone } {
  switch (code) {
    case 0:
      return { key: 'exit.finished', tone: 'ok' }
    case 129:
    case 143:
      return { key: 'exit.closed', tone: 'muted' }
    case 130:
      return { key: 'exit.interrupted', tone: 'muted' }
    case 137:
      return { key: 'exit.killed', tone: 'danger' }
    default:
      return { key: 'exit.failed', params: { code }, tone: 'danger' }
  }
}

/** The wording for a code, through whichever `t` the caller has (renderer hook or the notifier's lang-bound one). */
export function exitText(t: (key: MessageKey, params?: MessageParams) => string, code: number): string {
  const { key, params } = exitStatusOf(code)
  return t(key, params)
}
