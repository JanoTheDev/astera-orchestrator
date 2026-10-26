// T6: the lines Settings › Agents shows under a cap Astera lowered itself. Pure, so a test can pick them.
import type { AutoLimit, AutoLimits } from '../../../core/types'
import type { MessageKey } from '../../../core/i18n'

type T = (key: MessageKey, params?: Record<string, string | number>) => string

/** The lowered note for the workers or heavy cap, or null when Astera has not lowered it. `date` formats the ISO time. */
export function autoLimitNote(
  auto: AutoLimits,
  kind: 'workers' | 'heavy',
  t: T,
  date: (iso: string) => string = (iso) => new Date(iso).toLocaleString()
): string | null {
  const a: AutoLimit | undefined = auto[kind]
  if (!a) return null
  const lowered = t('settings.autoLimit.lowered', { count: a.cap, date: date(a.at), detail: a.detail })
  return `${lowered} ${t(a.cause === 'strain' ? 'settings.autoLimit.backByItself' : 'settings.autoLimit.staysUntilRestored')}`
}

/** The newest crash or oom lowering time, or null. History is newest last. */
export function newestCrashLowering(auto: AutoLimits): string | null {
  for (let i = auto.history.length - 1; i >= 0; i--) {
    const h = auto.history[i]
    if ((h.cause === 'crash' || h.cause === 'oom') && h.to !== null) return h.at
  }
  return null
}
