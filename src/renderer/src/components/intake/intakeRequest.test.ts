import { describe, expect, it } from 'vitest'
import { intakeRequest, type IntakeForm } from './intakeRequest'

const form = (o: Partial<IntakeForm> = {}): IntakeForm => ({
  tab: 'describe',
  text: '',
  fixlist: false,
  files: [],
  scope: '',
  issues: [],
  assignMe: false,
  instructions: '',
  project: { id: 'p1', path: '/repo' },
  coordinatorAccount: 'acc1',
  ...o
})

describe('intakeRequest', () => {
  it('Describe makes jobs-create, fixlist when the text is a problem list, with the extra instructions', () => {
    expect(intakeRequest(form({ text: ' Do X ', instructions: ' no deps ' }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', instructions: 'no deps', objective: 'Do X' }
    })
    expect(intakeRequest(form({ text: '1. a', fixlist: true }))?.args).toMatchObject({ mode: 'fixlist' })
  })
  it('Files attaches the dropped paths; Audit sends its scope, all when empty', () => {
    expect(intakeRequest(form({ tab: 'files', files: ['/d/a.pdf'] }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', attach: ['/d/a.pdf'] }
    })
    expect(intakeRequest(form({ tab: 'audit' }))?.args).toMatchObject({ mode: 'audit', scope: 'all' })
    expect(intakeRequest(form({ tab: 'audit', scope: 'src/core' }))?.args).toMatchObject({ scope: 'src/core' })
  })
  it('GitHub makes one Job from every picked issue, assigning them when asked', () => {
    expect(intakeRequest(form({ tab: 'github', issues: ['12', '14'], assignMe: true }))).toEqual({
      cmd: 'jobs-create-from-issue',
      args: { project: 'p1', issue: '12,14', assignMe: true, coordinatorAccount: 'acc1' }
    })
  })
  it('is null without a project, an account, or the tab’s source', () => {
    for (const f of [
      form({ text: 'x', project: null }),
      form({ text: 'x', coordinatorAccount: '' }),
      form(),
      form({ tab: 'files' }),
      form({ tab: 'github' })
    ])
      expect(intakeRequest(f)).toBeNull()
  })
})
