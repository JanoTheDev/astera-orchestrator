// T6: the lines Settings › Agents shows under a cap Astera lowered itself. Pure, so a test can pick them.
import type { AgentLimits, AutoLimit, AutoLimits } from '../../../core/types'
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

/** The line under the agent limit while an auto-limit holds it below the person's own ("Running at most 9 of your 25
 *  now: lowered by Astera on ..."), with whether it returns by itself (strain) or stays until restored (crash, oom).
 *  Null when nothing lowers it. */
export function effectiveLimitNote(
  limits: AgentLimits,
  t: T,
  date: (iso: string) => string = (iso) => new Date(iso).toLocaleString()
): string | null {
  const a = limits.autoLimit
  if (!a) return null
  const head = t('settings.autoLimit.effective', { count: limits.effective, person: limits.person, date: date(a.at), detail: a.detail })
  return `${head} ${t(a.cause === 'strain' ? 'settings.autoLimit.backByItself' : 'settings.autoLimit.staysUntilRestored')}`
}

/** Information, not a warning: a limit above what the measured memory fits. Null when it is within the recommendation. */
export function aboveRecommendedNote(limits: Pick<AgentLimits, 'person' | 'recommended' | 'memoryPerAgentGb'>, t: T): string | null {
  if (limits.person <= limits.recommended) return null
  return t('settings.maxWorkers.overRecommended', { count: limits.recommended, memory: Number(limits.memoryPerAgentGb.toFixed(1)) })
}

/** The newest crash or oom lowering time, or null. History is newest last. */
export function newestCrashLowering(auto: AutoLimits): string | null {
  for (let i = auto.history.length - 1; i >= 0; i--) {
    const h = auto.history[i]
    if ((h.cause === 'crash' || h.cause === 'oom') && h.to !== null) return h.at
  }
  return null
}
