import { describe, expect, it } from 'vitest'
import { CONSOLE_BRIEF } from './brief'

describe('CONSOLE_BRIEF', () => {
  it('names the commands the console plans and reports with', () => {
    for (const cmd of ['astera main-plan', 'astera jobs list', 'astera jobs create', '--cwd', 'astera tasks list', 'astera projects list'])
      expect(CONSOLE_BRIEF).toContain(cmd)
  })

  it('says it serves every project and that only a person starts a Job', () => {
    expect(CONSOLE_BRIEF).toMatch(/every project/)
    expect(CONSOLE_BRIEF).toContain('Only a person starts a Job')
  })
})
