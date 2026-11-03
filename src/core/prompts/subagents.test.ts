import { describe, expect, it } from 'vitest'
import { SUBAGENT_FINAL_CHECK, subagentGuidance } from './subagents'
import { PROMPT_ROLES } from './ownerInstructions'
import { LAUNCH_FORBIDDEN } from '../sessions/commands'
import { buildReviewSpecFile, buildSpecFile } from '../orchestration/exec/coordinator'
import { buildHandoverPrompt, buildPlannerBrief } from '../orchestration/handover'
import { buildReplanBrief } from '../orchestration/exec/replanStart'
import { codexDeveloperInstructions, sessionContextLines } from '../sessions/sessionContext'

describe('subagentGuidance', () => {
  it('every role is told to use subagents, names both tools, and keeps the final check', () => {
    for (const role of PROMPT_ROLES) {
      const g = subagentGuidance(role)
      expect(g).toContain('Use subagents (the Agent tool in Claude Code, parallel sub-tasks in Codex where available)')
      expect(g.endsWith(SUBAGENT_FINAL_CHECK)).toBe(true)
      // one line, safe on a codex command line (the session line goes there)
      expect(LAUNCH_FORBIDDEN.test(g)).toBe(false)
    }
  })
  it('each role fans out its own kind of work', () => {
    expect(subagentGuidance('session')).toContain('broad read-only exploration across many files, independent sub-parts, parallel verification')
    expect(subagentGuidance('worker')).toContain('independent sub-parts of the Task')
    expect(subagentGuidance('reviewer')).toContain('read the changed files or areas in parallel')
    expect(subagentGuidance('planner')).toContain('explore the codebase before you plan')
    expect(subagentGuidance('coordinator')).toContain('read reports, changed files and plan text in parallel')
  })
})

describe('every built prompt carries its role\'s subagent guidance', () => {
  const ids = { taskId: 'tsk_1', dispatchId: 'dsp_1' }
  it('worker spec (also what repair, recovery, merge and delivery-fix workers get, all built by buildSpecFile)', () => {
    expect(buildSpecFile({ title: 'T', spec: 'S', ...ids })).toContain(subagentGuidance('worker'))
  })
  it('reviewer spec', () => {
    expect(buildReviewSpecFile({ title: 'T', spec: 'S', ...ids, validated: true })).toContain(subagentGuidance('reviewer'))
  })
  it('coordinator brief, planning or not', () => {
    for (const taskCount of [0, 3])
      expect(buildHandoverPrompt({ runId: 'run_1', objective: 'o', concurrency: 2, taskCount })).toContain(subagentGuidance('coordinator'))
  })
  it('planner brief and replan brief', () => {
    expect(buildPlannerBrief({ jobId: 'job_1', objective: 'o', repoRoot: '/r', accountId: 'a', concurrency: 2 })).toContain(subagentGuidance('planner'))
    expect(
      buildReplanBrief({ job: { id: 'job_1', objective: 'o', cwd: '/r' }, runId: 'run_1', mode: 'wave', wave: 1, accountId: 'a', followUps: 0, done: [], running: [], left: [] })
    ).toContain(subagentGuidance('planner'))
  })
  it('every session start context (hand-opened tabs included), Claude hook and codex alike', () => {
    expect(sessionContextLines({}, null)).toContain(`- ${subagentGuidance('session')}`)
    const codex = codexDeveloperInstructions({ profileDir: 'P', codexHome: 'C', read: () => null })
    expect(codex).toContain(subagentGuidance('session'))
  })
})
