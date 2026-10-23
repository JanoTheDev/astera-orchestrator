// Japanese · accounts area. Which files each area serves: ../README.md.
import type { accounts as ko } from '../ko/accounts'

export const accounts: Partial<Record<keyof typeof ko, string>> = {
  'settings.accounts.hint':
    "「設定をインポート」は同じ CLI の既定アカウントから設定をコピーします。既定アカウントはサインイン済みで最も早く登録されたもので、CLI ごとに 1 つです。",
  // AccountPanel.tsx — account register, import, detect, logout, settings sync
  'account.field.kind': '種類',
  'account.field.label': 'ラベル',
  'account.panel.title': 'アカウント',
  'account.panel.empty': 'アカウントを追加してください',
  'account.add.title': 'アカウントを追加',
  'account.add.button': '追加',
  'account.add.adding': '追加中…',
  'account.add.labelPlaceholder': '例: 会社アカウント',
  'account.add.copySettingsLabel': '既定のアカウントから設定を取り込む',
  'account.add.syncFailed': 'アカウントは追加されましたが、設定の取り込みに失敗しました: {detail}',
  'account.import.title': 'アカウントの取り込み',
  'account.import.button': '取り込む',
  'account.import.someFailed': '{count} 件のアカウントの登録に失敗しました。',
  'account.detect.title': '検出されたアカウント',
  'account.detect.empty': '検出されたアカウントはありません',
  'account.detect.importSelected': '選択項目を登録',
  'account.detect.failed': '自動検出に失敗しました: {detail}',
  // AccountPanel.tsx — unregister. When logout comes with it, it says the credentials are removed (destructive).
  'account.remove.title': 'アカウントの登録解除',
  'account.remove.button': '登録解除',
  'account.remove.confirm': '「{label}」アカウントの登録を解除しますか？',
  'account.remove.logoutToo': 'ログアウトも実行 (認証情報を削除)',
  'account.remove.logoutWarning':
    'ログアウトするとこのアカウントの認証情報が削除され、再度ログインが必要になります。ホームディレクトリ (~/.claude, ~/.codex) を使うアカウントの場合、このアプリの外で使っていたログインも一緒に解除されます。',
  'account.remove.processing': '処理中…',
  'account.remove.confirmWithLogout': '解除 + ログアウト',
  'account.logout.failed': 'ログアウトに失敗しました: {detail}\n\n登録解除はこのまま続行します。',
  'account.remove.inUse': '実行中のセッションがこのアカウントを使用しているため、登録を解除できません: {titles}\n\nセッションを閉じるか、そのセッションのローテーション順からこのアカウントを外してください。',
  // AccountPanel.tsx — default-account settings sync. A destructive action that overwrites the target account's settings.
  'account.sync.title': '既定アカウントの設定を取り込む',
  'account.sync.confirmBody':
    '「{source}」アカウントの設定を「{label}」アカウントへ取り込みます。',
  'account.sync.mergeNote':
    'プラグイン・MCP・個人のスキル/コマンド/エージェントを項目単位でマージします。同じ項目は取り込み元の値で上書きし、このアカウントにしかない項目は残ります。',
  'account.sync.replaceNote':
    'config.toml ファイルが取り込み元のものでまるごと置き換えられます。このアカウントにしかなかった設定は失われ、既存のファイルは .bak としてバックアップします。',
  'account.sync.appliesNextSession':
    '実行中のセッションには適用されず、次のセッションから反映されます。',
  'account.sync.confirm': '取り込む',
  'account.sync.confirming': '取り込み中…',
  'account.sync.done': '設定を取り込みました。',
  'account.sync.failed': '取り込みに失敗しました: {detail}',
  // Usage run-out estimate: when the account runs out at the current pace, before its reset
  'account.usage.runOut': '今のペース（約 {rate}%/時）だと、リセット前に {duration} で使い切ります',
  'account.usage.lasts': '今のペース（約 {rate}%/時）なら、リセットまでもちます',
  // Account picker: the signed-out label, the usage figures and the project default row
  'account.select.signedOut': 'サインアウト中',
  'account.select.usage': '5時間 {session}% · 週 {weekly}%',
  // Switch a running tab account: the menu action, its confirmation and its failure messages
  'account.switch.action': 'このタブで使う',
  'account.switch.title': '開いているタブを {label} に移します。会話はそこで続きます',
  'account.switch.done': 'このタブは {label} で動くようになりました',
  'account.switch.failed': 'アカウントを切り替えられませんでした: {detail}',
  'account.switch.busy': 'このタブはすでにアカウントを切り替え中です。少しして再度お試しください',
  'account.switch.noTab': 'セッションタブを開くと、別のアカウントに移せます',
  'account.switch.otherProvider': '{provider} のアカウントだけがこのタブを引き継げます',
  // W3 redesign: rename button, near-limit cue, plain import button, empty states
  'account.rename.button': "名前を変更",
  'account.menu.label': "{label} の操作",
  'account.usage.nearLimit': "上限に近づいています",
  'account.sync.button': "設定をインポート",
  'account.empty.body': "アカウントを追加すると、Astera が Claude または Codex のサブスクリプションでエージェントを実行できます。",
  'account.empty.bodySettings': "上部バーのアカウントメニューから追加できます。",
}
