// Japanese · agents area. Which files each area serves: ../README.md.
import type { agents as ko } from '../ko/agents'

export const agents: Partial<Record<keyof typeof ko, string>> = {
  'session.placeholder.start': '+ 新しいセッションを開始',
  // App.tsx — run console resizer, start failure
  'run.resizeConsole': 'コンソールのサイズ変更',
  // WorkbenchTabs.tsx — the dirty marker on a file tab
  'explorer.tab.unsaved': '未保存',
  // WorkbenchTabs.tsx
  'session.tab.rollTooltip': 'ローリング: {chain}',
  // ConversationPane.tsx — exited banner (session-failure-visibility design D2/F2). この部分カタログには
  // 他の conversation.* キーがまだ無く(en/ko で代替される)、この3つだけを先に入れる。
  'conversation.indexingFiles': 'ファイル一覧を作成しています…',
  'conversation.filesUnavailable': 'このフォルダーのファイル一覧を取得できません。',
  'conversation.exited.detail': '詳細',
  'conversation.exited.restart': '再開',
  // design §4 F5 の確認ダイアログの5つの項目。S1(1〜2行)の例外 — 本人にしかできない判断なので、
  // 事実を削るとボタンだけが残る。
  'conversation.exited.bypassConfirm.title': 'このフォルダの toolchain 設定をスキップして再試行しますか?',
  'conversation.exited.bypassConfirm.whatBlockedLabel': '何が止めたか',
  'conversation.exited.bypassConfirm.whatBlocked':
    'CLI ではなく、PATH の手前にあるツールバージョン管理ツール(Volta)が実行を拒否しました。このフォルダの package.json を読んでどのバージョンを使うか決める必要がありますが、そのファイルを読めませんでした',
  // fix round 1 / Important 4: VOLTA_HOME しか一致しなかったときの文言。Volta がこの端末に入っている
  // ことは確かだが、それが*この* CLI を止めたという確証ではない — Volta は Node を管理していて、
  // codex は別にアンチウイルスが止めた単独インストールという可能性がある。
  'conversation.exited.bypassConfirm.whatBlockedSoft':
    'この CLI 自体ではなく、この端末に入っているツールバージョン管理ツール(Volta)が原因かもしれません。Volta が管理する対象なら、PATH 手前の Volta がこのフォルダの package.json を読んでバージョンを決めようとして実行を拒否した可能性があります',
  'conversation.exited.bypassConfirm.ifSkippedLabel': 'スキップすると',
  'conversation.exited.bypassConfirm.ifSkipped': 'バージョン判定を省略し、デフォルトの CLI をそのまま実行します。セッションは起動します。',
  'conversation.exited.bypassConfirm.givesUpLabel': '何を諦めるか',
  'conversation.exited.bypassConfirm.givesUp':
    'このプロジェクトに固定したツールバージョンです。このセッションだけでなく、このセッションが実行するすべてのコマンド(エージェントが実行する npm test、npm run build、node …)が固定バージョンではなくデフォルトバージョンで動きます。同じコマンドでも、あなたのターミナルとは異なる結果になることがあります。利用上限で別アカウントに切り替わったとき、引き継ぐセッションも同じです。',
  'conversation.exited.bypassConfirm.properFixLabel': '本当の解決',
  'conversation.exited.bypassConfirm.properFix': 'package.json を修正すれば、このダイアログは再び表示されません。',
  'conversation.exited.bypassConfirm.confirm': 'スキップして再試行',
  'conversation.exited.bypassConfirm.failed': '再試行できませんでした',
  // fix round 1 (Critical 2): 消えない印。notice と違い最初のターンで消えず、このセッションが
  // (そして終わった後も)存在する限り、常にその事実だけを言う一行として残る。
  'conversation.bypassed.badge': 'このセッションはこのプロジェクトに固定した toolchain のバージョンをスキップして開始されました',
  // TerminalView.tsx — the rolling banner and the loading/exit overlays
  'session.terminal.rollSwitching': '「{label}」に切り替えています…',
  'session.terminal.trustAccepting': 'フォルダの信頼を自動承認しています…',
  // {time} here is fmtDateTime (M/D HH:MM), not fmtTime — no preposition can precede it
  'session.terminal.weeklyLimitWaiting': '週間上限に到達 — {time} に自動再開',
  'session.terminal.limitWaiting': '上限に到達 — {time} に自動再開',
  'session.terminal.loadingContent': '内容を読み込み中…',
  'session.terminal.sizedRemote': 'リモートコンピューターのウィンドウサイズで表示しています。入力するとこのウィンドウのサイズに切り替わります。',
  'session.terminal.restart': '再起動',
  'session.terminal.schedNextRun': ' · 次回実行 {time}',
  'session.terminal.schedDisable': 'オフにする',
  'run.panel.empty': 'まだ何も実行されていません。ツールバーの実行を押して実行構成を開始してください。',
  'run.panel.stopping': '停止中…',
  'run.panel.close': '実行を閉じる',
  'run.panel.openPreview': '{url} をプレビューで開く',
  'conversation.sentFile.open': '{name} を開く',
  // ---- preview ----
  'preview.tab.untitled': 'プレビュー',
  'preview.agent.tab': 'エージェント',
  'preview.agent.running': 'エージェントがこのページを操作しています',
  // エージェントアプリ作業スペースのミラータブ
  'workspace.tab.tag': 'アプリ',
  'workspace.tab.running': 'エージェントが見えないデスクトップでアプリを操作しています',
  // Task 7 — toolchain バイパスで再起動したことは必ず伝える(design F5)。落ち着いた状態ではなく
  // 新しい知らせなので、他の chat.notice.* キーがまだここに無くても訳す
  'chat.notice.bypassed': 'このフォルダーの toolchain 設定を飛ばして起動しました — 固定したバージョンと違う可能性があります',
  'remote.session.readOnly': 'この Runtime は読み取り専用でペアリングされているため、ここからは入力できません。',
  'remote.session.reconnecting': 'Runtime に再接続しています。セッションはそちらで動き続けています。',
  'remote.session.gone': 'このセッションの出力を受け取れません: {message}',
  'remote.session.ended': 'セッションが終了しました (終了コード {code})',
  'remote.session.sizedHost': 'ホストコンピューターのウィンドウサイズで表示しています。入力するとこのウィンドウのサイズに切り替わります。',
  'remote.session.sizedOther': '別のリモートコンピューターのウィンドウサイズで表示しています。入力するとこのウィンドウのサイズに切り替わります。',
  'remote.session.sizedHostFixed': 'ホストコンピューターのウィンドウサイズで表示しています。',
  'remote.session.noPty': 'Runtime がこのセッションの端末をまだ知らせていません',
  'remote.session.readOnlyAnswer': 'このセッションは回答を待っていますが、読み取り専用のペアリングではここから回答できません。',
  'remote.session.notReadable': 'このセッションの会話はまだ Runtime で読めません。',
  'remote.session.status.working': '作業中',
  'remote.session.status.waiting': '回答待ち',
  'remote.session.status.idle': '待機',
  'remote.session.status.unknown': '状態不明',
  'remote.session.earlier': '以前の会話',
  'remote.session.chatEnded': 'このセッションは Runtime で終了しました。',
  'remote.session.composer': 'Runtime のセッションへのメッセージ',
  'remote.session.inputLost': '今入力した内容は Runtime に届きませんでした。接続が戻ったらもう一度入力してください。',
  'tabs.recent.title': '最近閉じたタブ',
  'tabs.recent.running': '実行中',
  'tabs.recent.ended': '終了',
  'wall.end.title': '{name} を終了しますか?',
  'wall.end.body': 'このコンソールはまだ動いています。終了するとプロセスが止まります。',
  'wall.end.confirm': 'セッションを終了',
  'summary.facts.questions': '質問: {n}（リードエージェント {coordinator}、あなた {owner}）',
  'summary.role.worker': 'エージェント',
  'tabs.strip.label': '開いているタブ',
  'conversation.completion.label': '候補',
  'agents.view.idle': '待機中',
  'agents.view.empty': 'このプロジェクトで実行中のセッションはありません。+ ボタンか新しいプランから始めてください。',
  'agents.view.planEmpty': '{name} にはまだコンソールがありません。',
  'agents.view.open': 'コンソールを開く',
  'agents.view.filter': 'プランで絞り込む',
  'agents.row.open': '開く',
  'agents.row.side': '横に開く',
  'agents.row.plan': 'プランへ移動',
  'agents.row.rename': '名前を変更',
  'agents.row.stop': '停止',
  'agents.row.started': '開始: {when}',
  'agents.row.lastActive': '最終アクティビティ: {when}',
  'agents.header.label': 'コンソール',
  'agents.header.plan': 'プラン {name} を開く',
  'agents.header.task': 'プランでタスク {name} を表示',
  'agents.header.restart': '再起動',
}
