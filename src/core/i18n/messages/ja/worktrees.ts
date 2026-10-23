// Japanese · worktrees area. Which files each area serves: ../README.md.
import type { worktrees as ko } from '../ko/worktrees'

export const worktrees: Partial<Record<keyof typeof ko, string>> = {
  'session.new.starting': 'セッションを開始しています…',
  'session.new.startingWorktree': 'worktree を作成しています…',
  'session.new.stage.fetch': 'ベースブランチを取得しています…',
  'session.new.stage.checkout': 'ファイルをチェックアウトしています…',
  'session.new.stage.copyIncludes': 'インクルードファイルをコピーしています…',
  'session.new.stage.copyCount': '{copied} / {total} · ファイル {files} / {filesTotal}',
  'session.new.cancelling': 'キャンセルしています…',
  // WorktreePanel.tsx — status labels
  'worktree.status.orphanDir': 'git 登録が消失',
  'worktree.status.unreachable': 'フォルダーに接続できません',
  'worktree.status.gitUnchecked': 'git を確認できません',
  // WorktreePanel.tsx — delete confirmation modal, result toasts
  'worktree.remove.title': 'worktree の削除',
  'worktree.remove.body':
    '{name} ({branch})\n{path}\n\nこの worktree を削除しますか？ フォルダとブランチを一緒に削除します。マージされていないブランチはコミットを失わないよう残します。',
  'worktree.remove.branchPreserved': 'ブランチ {branch} はマージされていないため残しました',
  'worktree.remove.done': 'worktree を削除しました',
  'worktree.remove.alreadyGone': '{name} はすでに削除されていたため一覧から整理しました',
  // Shown on the row while deleting
  'worktree.remove.removing': '削除中…',
  // WorktreePanel.tsx — force-delete second confirmation
  'worktree.forceRemove.unverifiableTitle': '変更の有無を確認できません',
  'worktree.forceRemove.dirtyTitle': 'コミットされていない変更',
  'worktree.forceRemove.unverifiableBody':
    '{name} は git がもう追跡していないため、未コミットの変更の有無を確認できません。\n{path}\n強制削除するとフォルダの内容が失われます。フォルダを直接開いて確認してから進めてください。',
  'worktree.forceRemove.dirtyBody':
    '{name} にコミットされていない変更が {count} 件あります。\n強制削除すると変更内容が失われます。続行しますか？',
  'worktree.forceRemove.confirm': '強制削除',
  // WorktreePanel.tsx — panel header, row icon buttons
  'worktree.refresh': '更新',
  'worktree.action.startSession': 'セッションを開始',
  'worktrees.hint': 'ワークツリーは同じリポジトリの別フォルダーで、専用のブランチを持ちます。エージェントがあなたのファイルに触れずに作業できます。',
  'worktrees.helpLabel': 'ワークツリーとは？',
  'worktrees.gone': 'このワークツリーは一覧にありません。',
  'worktrees.menu.openExplorer': 'エクスプローラーで開く',
  'worktrees.changesPane': '変更',
  'worktrees.changesPick': 'ワークツリーを選ぶと変更が表示されます。',
  'worktrees.aheadBehind': '{ahead} 先行、{behind} 遅れ',
  'worktrees.rowMenu': 'ワークツリーの操作',
  'worktrees.prMenu': 'プルリクエストの操作',
}
