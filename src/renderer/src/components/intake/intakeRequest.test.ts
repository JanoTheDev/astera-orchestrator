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
  concurrency: 3,
  ...o
})

describe('intakeRequest', () => {
  it('Describe makes jobs-create, fixlist when the text is a problem list, with the extra instructions', () => {
    expect(intakeRequest(form({ text: ' Do X ', instructions: ' no deps ' }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, instructions: 'no deps', objective: 'Do X' }
    })
    expect(intakeRequest(form({ text: '1. a', fixlist: true }))?.args).toMatchObject({ mode: 'fixlist' })
  })
  it('Files attaches the dropped paths; Audit sends its scope, all when empty', () => {
    expect(intakeRequest(form({ tab: 'files', files: ['/d/a.pdf'] }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, attach: ['/d/a.pdf'] }
    })
    expect(intakeRequest(form({ tab: 'audit' }))?.args).toMatchObject({ mode: 'audit', scope: 'all' })
    expect(intakeRequest(form({ tab: 'audit', scope: 'src/core' }))?.args).toMatchObject({ scope: 'src/core' })
  })
  // W8-C prompts mode
  it('Run as written sends --mode prompts with the .md files, else the pasted document; ask only when ticked', () => {
    expect(intakeRequest(form({ tab: 'prompts', files: ['/d/W9-A.md'], text: 'ignored' }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, mode: 'prompts', attach: ['/d/W9-A.md'] }
    })
    expect(intakeRequest(form({ tab: 'prompts', text: '## a\nx\n## b\ny', approveAsk: true }))?.args).toMatchObject({
      mode: 'prompts',
      objective: '## a\nx\n## b\ny',
      approve: 'ask'
    })
    expect(intakeRequest(form({ tab: 'prompts' }))).toBeNull()
  })
  it('GitHub makes one Job from every picked issue, assigning them when asked', () => {
    expect(intakeRequest(form({ tab: 'github', issues: ['12', '14'], assignMe: true }))).toEqual({
      cmd: 'jobs-create-from-issue',
      args: { project: 'p1', issue: '12,14', assignMe: true, coordinatorAccount: 'acc1', concurrency: 3 }
    })
  })
  it('W7-D (#67): sends the worker count the owner picked, on every tab', () => {
    for (const f of [form({ text: 'x' }), form({ tab: 'files', files: ['/a'] }), form({ tab: 'audit' }), form({ tab: 'github', issues: ['1'] })])
      expect(intakeRequest({ ...f, concurrency: 10 })?.args).toMatchObject({ concurrency: 10 })
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
