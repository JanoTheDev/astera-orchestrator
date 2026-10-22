// Japanese · misc area. Which files each area serves: ../README.md.
import type { misc as ko } from '../ko/misc'

export const misc: Partial<Record<keyof typeof ko, string>> = {
  'session.usage.fiveHourLabel': '5時間使用量',
  // W2-A planner stage
  'jobs.new.planner': '先にプランナーで計画する',
  'jobs.new.schedule': '予約実行',
  'remote.sessions.signedOut': '未ログイン',
  'new.console': 'コンソール',
  'new.plan': '計画を任せる',
  'new.prompts': '書いたとおりに実行',
  'start.title': '{project} で何を作りますか?',
  // T2 Start: Audit mode, sticky hands-off, More options
  // T4 Start opens the planner chat
}
