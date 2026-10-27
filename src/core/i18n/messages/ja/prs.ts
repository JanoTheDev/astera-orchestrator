// Japanese · prs area. Which files each area serves: ../README.md.
import type { prs as ko } from '../ko/prs'

export const prs: Record<keyof typeof ko, string> = {
  'prs.refresh': '更新',
  'prs.filter': 'タイトル、作成者、ブランチで絞り込み',
  'prs.noProject': 'Pull request を見るにはプロジェクトを選んでください。',
  'prs.loading': 'Pull request を読み込み中…',
  'prs.empty': '開いている Pull request はありません。',
  'prs.noMatch': '条件に合う Pull request はありません。',
  'prs.notInstalled': 'GitHub CLI（gh）がインストールされていません。インストールしてからアプリを再起動してください。',
  'prs.notAuthenticated': 'GitHub にサインインしていません。',
  'prs.openSettings': 'GitHub 設定を開く',
  'prs.noRemote': 'このプロジェクトには GitHub のリモートがありません。',
  'prs.error': 'Pull request を読み込めませんでした: {detail}',
  'prs.draft': '下書き',
  'prs.review': 'AI でレビュー',
  'prs.github': 'GitHub で開く',
  'prs.merge': 'マージ',
  'prs.notMergeable': 'まだマージできません。競合、必須チェック、レビューを確認してください。',
  'prs.alreadyMerged': 'すでにマージまたはクローズされています。',
  'prs.updated': '{age}前',
  'prs.menu': 'Pull request の操作',
  'prs.list': 'Pull request 一覧'
}
