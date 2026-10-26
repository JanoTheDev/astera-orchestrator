import { describe, expect, it } from 'vitest'
import { planChatBrief } from './planChatBrief'

const job = { id: 'job_1', objective: 'Ship the thing. Then more.', cwd: '/repo', title: 'Ship it' }

describe('planChatBrief', () => {
  it('names the plan, its folder and the CLI reads for progress', () => {
    const b = planChatBrief(job)
    expect(b).toContain('plan job_1 "Ship it" in /repo')
    expect(b).toContain('astera jobs get --id job_1')
    expect(b).toContain('astera tasks list --run job_1')
    expect(b).toContain('astera dispatch-show --task')
    expect(b).toContain('astera sessions read --id')
  })

  it('passes changes to the planner with jobs feedback', () => {
    expect(planChatBrief(job)).toContain('astera jobs feedback --job job_1 --text -')
  })

  it('forbids starting, approving and changing work', () => {
    const b = planChatBrief(job)
    expect(b).toMatch(/Never start, approve, stop, reject or merge anything/)
    expect(b).toContain('Change no files.')
  })

  it('names an untitled plan by its objective', () => {
    expect(planChatBrief({ ...job, title: undefined })).toContain('"Ship the thing"')
  })
})
