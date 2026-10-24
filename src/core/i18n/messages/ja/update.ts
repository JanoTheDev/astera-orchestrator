// Japanese · update area. Which files each area serves: ../README.md.
import type { update as ko } from '../ko/update'

export const update: Partial<Record<keyof typeof ko, string>> = {
  'update.manual.title': '手動インストール',
  'update.manual.quit': '終了して移動する',
  // App.tsx — the toast for a downloaded new version, and the session-kill confirmation when installing now
  'update.toast.available': '新しいバージョン v{version} が公開されました',
  'update.toast.updatedTo': '{sha} に更新しました',
  'update.toast.updatedMore': 'ほか {count} 件',
  'update.toast.download': 'ダウンロード',
  'update.confirm.title': '今すぐインストールして再起動',
  'update.confirm.body': '進行中のセッション {count} 件が終了します。続行しますか？',
  // UpdateGate.tsx — the screen that covers the app when the version is below the minimum
  'update.gate.title': 'アップデートが必要です',
  'update.gate.body': 'バージョン {version} へのアップデートをお願いします',
  'update.gate.bodyNoVersion': 'アップデートを進めてください',
  'update.gate.preparing': 'アップデートを準備しています…',
  'update.gate.ready': 'v{version} のインストール準備が完了しました',
  'update.gate.failed':
    'アップデートを取得できませんでした。ネットワークを確認して再試行してください。',
  'update.gate.retry': '再試行',
  'update.gate.quit': 'アプリを終了',
}
