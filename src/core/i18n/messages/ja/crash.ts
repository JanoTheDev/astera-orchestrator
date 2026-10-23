// Japanese · crash area. Which files each area serves: ../README.md.
import type { crash as ko } from '../ko/crash'

export const crash: Partial<Record<keyof typeof ko, string>> = {
  'crash.prompt.title': 'エラーレポートを送信しますか？',
  'crash.prompt.intro':
    'Astera でエラーが発生しました。以下が送信される内容そのままです。「送信」を押すと、この内容を入れた GitHub の Issue がブラウザで開き、そこで編集や取り消しができます。押さなければ何も送られません。',
  'crash.prompt.kept': 'レポートはこのコンピューターにだけ、最大 30 日間保存されます。',
  'crash.prompt.send': '送信',
  'crash.prompt.dontSend': '送信しない',
  'crash.prompt.never': '今後は確認しない',
  'crash.prompt.reportLabel': '送信するレポート'
}
