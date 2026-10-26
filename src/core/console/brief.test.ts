import { describe, expect, it } from 'vitest'
import { CONSOLE_BRIEF } from './brief'

describe('CONSOLE_BRIEF', () => {
  it('names the commands the console plans and reports with', () => {
    for (const cmd of ['astera main-plan', 'astera jobs list', 'astera jobs create', '--cwd', 'astera tasks list', 'astera projects list', 'astera jobs plan', 'astera jobs feedback', 'main-plan'])
      expect(CONSOLE_BRIEF).toContain(cmd)
  })

  it('forbids the commands only a person runs', () => {
    expect(CONSOLE_BRIEF).toContain('Only a person starts or approves a Job')
    for (const cmd of ['astera jobs run', 'run-start', 'runs resume', 'tasks dispatch']) expect(CONSOLE_BRIEF).toContain(cmd)
  })

  it('tasks add takes no --account', () => {
    const line = CONSOLE_BRIEF.split('\n').find((l) => l.includes('astera tasks add'))
    expect(line).toBeDefined()
    expect(line).not.toContain('--account')
  })

  it('says it serves every project and that only a person starts a Job', () => {
    expect(CONSOLE_BRIEF).toMatch(/every project/)
      })
})
