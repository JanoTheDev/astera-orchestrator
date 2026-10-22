// Japanese · plans area. Which files each area serves: ../README.md.
import type { plans as ko } from '../ko/plans'

export const plans: Partial<Record<keyof typeof ko, string>> = {
  'pages.plans.status.deliveryDismissed': '配信を見送り',
  'jobs.convergence.chip.repairing': '修正 {repairs}/{max}',
  'jobs.convergence.chip.reviewing': 'レビュー {round}/{max}',
  'jobs.convergence.chip.exhausted': '上限到達',
  'jobs.convergence.chip.stopped': '修正停止',
  'jobs.source.chipOpen': '{label} をブラウザで開く',
  // JobsView.tsx — 動いている行の provider の後ろ。待機中は経過時間の代わりにこれを書き、
  // 再開歴があれば後ろに続ける（{left}・{n} は core/i18n/index.ts の {name} 置換）。
  'jobs.task.waitingReset': 'リセット待ち · {left}',
  'jobs.task.waitingNoTime': 'リセット待ち',
  'jobs.task.resumedCount': '{n} 回再開',
}
