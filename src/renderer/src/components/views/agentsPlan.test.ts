import { describe, expect, it } from 'vitest'
import { getAgentsPlan, planJobIdOf, setAgentsPlan, setAgentsPlanRefs } from './agentsPlan'

const plans = [
  { jobId: 'job_1', runId: 'run_1', name: 'One' },
  { jobId: 'job_2', name: 'Two' }
]

describe('agentsPlan', () => {
  it('starts on every plan and keeps the last plan set, without storage too', () => {
    expect(getAgentsPlan()).toBe('all')
    setAgentsPlan('job_1')
    expect(getAgentsPlan()).toBe('job_1')
    setAgentsPlan('all')
    expect(getAgentsPlan()).toBe('all')
  })

  it('resolves a Run id to its Job id, once the plans are known', () => {
    setAgentsPlan('run_1')
    expect(getAgentsPlan()).toBe('run_1')
    setAgentsPlanRefs(plans)
    expect(getAgentsPlan()).toBe('job_1')
    setAgentsPlan('all')
    setAgentsPlanRefs([])
  })

  it('maps a Run id to its Job id, keeps a Job id, and keeps an unknown id as given', () => {
    expect(planJobIdOf('run_1', plans)).toBe('job_1')
    expect(planJobIdOf('job_2', plans)).toBe('job_2')
    expect(planJobIdOf('gone', plans)).toBe('gone')
  })
})
