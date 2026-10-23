// Japanese · about area. Which files each area serves: ../README.md.
import type { about as ko } from '../ko/about'

export const about: Partial<Record<keyof typeof ko, string>> = {
  'settings.group.about': 'このアプリについて',
  'about.buildVersion': 'ビルドバージョン',
  'about.copy': 'コピー',
  'about.copied': 'コピーしました',
  'about.copyVersion': 'ビルドバージョンをコピー',
  'about.updateChannel': 'アップデートチャンネル',
  'about.channel.stable': '安定版',
  'about.channel.beta': 'ベータ',
  'about.channel.hint': '安定版は完成したリリースだけを受け取ります。ベータは、全員に届く前のテスト版も受け取ります。',
  'about.channel.saveFailed': 'アップデートチャンネルを保存できませんでした: {detail}',
  'about.crashReports': 'クラッシュレポート',
  'about.crash.ask': '確認する',
  'about.crash.never': '送らない',
  'about.crash.hint': 'Astera でエラーが起きたとき、レポートを送るか確認します。レポートは送る前に内容を確認できます。「送らない」を選ぶと確認しなくなります。',
  'about.crash.saveFailed': 'クラッシュレポートの設定を保存できませんでした: {detail}',
  'about.license': 'ライセンス',
  'about.license.personal': '個人用ビルド',
  'about.licenses.title': 'オープンソースライセンス',
  'about.licenses.hint': 'Astera を構成するソフトウェアと、その利用条件です。',
  'about.licenses.open': '表示',
  'about.licenses.search': 'ライセンスを検索',
  'about.licenses.count': '{count} 件',
  'about.licenses.empty': '"{query}" に一致するライセンスはありません。',
  'about.licenses.loading': '読み込み中…',
  'about.licenses.missingTitle': 'ライセンス一覧がまだ生成されていません',
  'about.licenses.missing': 'Astera のフォルダーで node scripts/gen-licenses.mjs を実行し、このウィンドウを開き直してください。インストール版には最初から含まれています。',
  'about.licenses.noText': 'このパッケージにはライセンスファイルがありません。ライセンス欄には {license} とあります。',
  'about.licenses.pick': '左の項目を選ぶと全文が表示されます。'
}
