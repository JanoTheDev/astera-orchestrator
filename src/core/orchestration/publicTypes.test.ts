// The SDK's DTOs are checked against the app's own types by publicTypes.ts at compile time (npm run typecheck). This
// test only makes sure the checks stay in place: one per typed internal object the SDK returns, and nothing that runs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./publicTypes.ts', import.meta.url), 'utf8')

describe('publicTypes', () => {
  it('checks every typed internal object against its DTO', () => {
    for (const name of ['Project', 'Job', 'Run', 'Task', 'CheckResult', 'ReviewIssue', 'TaskAttempt', 'Question', 'RunCompletion', 'TaskCompletion', 'CompletionDetail', 'CompletionCheckDetail', 'RunEvent', 'ConvergencePolicy', 'GitRange', 'ScheduleRule'])
      expect(src, name).toMatch(new RegExp(`type _${name[0].toLowerCase()}${name.slice(1)} = Check<`))
  })

  it('holds types only', () => {
    expect(src).not.toMatch(/^export (const|function|class|let|var)\b/m)
    expect(src).not.toMatch(/^import (?!type)/m)
  })
})
