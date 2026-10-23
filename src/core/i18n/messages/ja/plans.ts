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
  'pages.plans.wave': 'ステップ {at}/{of}',
  'pages.plans.coordinator': 'リードエージェント · 進行中のプラン',
  'pages.plans.workers': '{n} 件のエージェントが作業中',
  'pages.plans.lease': '{plan} がファイルを使用中',
  'pages.plans.restartLead': "リードエージェントを再起動",
  'pages.plans.restartLeadHint': "このプランを管理するリードエージェントがいません。クリックして再度起動します",
  'pages.plans.holdNew': "新しいエージェントの起動を止める（実行中のものは続行）",
  'pages.plans.releaseNew': "新しいエージェントの起動を再開",
  'pages.plans.approveHint': "このプランを承認してエージェントを開始",
  'pages.plans.sharedFolderHint': "別プランのエージェントと同じフォルダーで実行中です。編集が混ざる可能性があり、アプリは防止も検知もしません",
  'pages.plans.host.waiting': "バックグラウンドサービスに接続中",
  'pages.plans.host.unreachable': "バックグラウンドサービスに接続できません",
  'pages.plans.host.features': "プラン、タスクの追跡、エージェントブラウザー、Smart Resume はすべてこの接続を待っています",
  'pages.plans.stall.unresponsive': "バックグラウンドサービスが応答しないため、プランは進みません。設定の情報から再起動できます",
  'pages.plans.stall.reading': "バックグラウンドサービスがまだ設定を読み込み中のため、プランはまだ進みません",
  'pages.plans.stall.parked': "バックグラウンドサービスがプランを一時停止しました: {reason}",
  'pages.plans.roundNumber': "ラウンド #{n}",
  'pages.plans.roundsSoFar': "これまで {count} ラウンド",
}
