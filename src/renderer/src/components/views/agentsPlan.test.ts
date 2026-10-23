import { describe, expect, it } from 'vitest'
import { getAgentsPlan, setAgentsPlan } from './agentsPlan'

describe('agentsPlan', () => {
  it('starts on every plan and keeps the last plan set, without storage too', () => {
    expect(getAgentsPlan()).toBe('all')
    setAgentsPlan('job_1')
    expect(getAgentsPlan()).toBe('job_1')
    setAgentsPlan('all')
    expect(getAgentsPlan()).toBe('all')
  })
})
