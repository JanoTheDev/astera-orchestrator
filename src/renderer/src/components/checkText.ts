// A check's verdict in words, for the run's graph (a chip and its tooltip) and a Task's completion block (plugin Phase 5
// C13). One source, so the two never word a check differently; pure, so the node tests hold it.
import type { JobCheck } from '../../../core/types'
import type { MessageKey, MessageParams } from '../../../core/i18n'
import { formatRunDuration } from '../../../core/run/duration'
import { PLUGIN_CHECK_PREFIX } from '../../../core/orchestration/pluginChecks'
import type { CheckPluginRow } from '../lib/orchDoor'
import { statusLabel } from './pluginsText'

export type Translate = (key: MessageKey, params?: MessageParams) => string

/** 칩 기호의 종류 — CheckResult.status 다섯에 그리기 위한 여섯째 `retrying` 이 더해진다: validating 인 Task 에서
 *  지난 라운드에 막혔던 검사는 지금 다시 도는 중이라는 뜻이다(UI 설계 U12 — validator 는 라운드 끝에만 결과를
 *  주므로 "지금 도는 검사" 는 그렇게밖에 알 수 없다). */
export type GlyphKind = JobCheck['status'] | 'retrying'
// `error` (a plugin check that could not be made, plugin Phase 5 C9) draws apart from a failure.
export const GLYPH: Record<GlyphKind, string> = { passed: '✓', failed: '✗', 'timed-out': '✗', 'not-run': '○', error: '!', retrying: '●' }

/** A check's verdict: a command check's failure with its exit code, a plugin's without one (it has none), one that
 *  could not be made, and one a person let the round go on without. */
export function checkVerdict(c: { status: JobCheck['status']; exitCode?: number; skipped?: true }, t: Translate): string {
  switch (c.status) {
    case 'passed':
      return t('jobs.convergence.check.passed')
    case 'failed':
      return c.exitCode !== undefined ? t('jobs.convergence.check.failed', { code: c.exitCode }) : t('jobs.convergence.check.failedNoCode')
    case 'timed-out':
      return t('jobs.convergence.check.timedOut')
    case 'error':
      return t('jobs.convergence.check.error')
    case 'not-run':
      return c.skipped ? t('jobs.convergence.check.skipped') : t('jobs.convergence.check.notRun')
  }
}

/** "{이름} — {결과} ({지난 라운드 실제 시간}), {흔들림}". 시간은 formatRunDuration 을 빌린다 — {startedAt, exitedAt}
 *  과 now 를 받는 함수라 0·durationMs·0 을 넘긴다(어댑터 한 줄). */
export function checkTooltip(c: JobCheck, glyph: GlyphKind, t: Translate): string {
  const verdict = glyph === 'retrying' ? t('jobs.convergence.check.retrying') : checkVerdict(c, t)
  const time = c.durationMs !== undefined ? ` (${formatRunDuration({ startedAt: 0, exitedAt: c.durationMs }, 0)})` : ''
  const flip = c.unstable ? `, ${t('jobs.convergence.check.unstable')}` : ''
  return `${c.name} — ${verdict}${time}${flip}`
}

/** The checks the new-Task window offers (plugin Phase 5 C6): the run configurations, then this computer's check
 *  plugins as "Plugin: <name>", one that is not running with its status. Plugins not read yet add nothing, so the run
 *  configurations are offered as soon as they arrive. */
export function checkChoicesOf(configs: { id: string; name: string }[], plugins: CheckPluginRow[] | null, t: Translate): { id: string; name: string }[] {
  return [
    ...configs,
    ...(plugins ?? []).map((p) => ({
      id: `${PLUGIN_CHECK_PREFIX}${p.id}`,
      name: p.status === 'running' ? t('jobs.task.checkPlugin', { name: p.name }) : t('jobs.task.checkPluginStatus', { name: p.name, status: statusLabel(p.status, t) })
    }))
  ]
}
