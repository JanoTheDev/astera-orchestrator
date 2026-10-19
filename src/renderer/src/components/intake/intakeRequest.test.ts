import { describe, expect, it } from 'vitest'
import { intakeRequest, type IntakeForm } from './intakeRequest'

const form = (o: Partial<IntakeForm> = {}): IntakeForm => ({
  tab: 'describe',
  text: '',
  fixlist: false,
  files: [],
  planning: 'chat',
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
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, instructions: 'no deps', objective: 'Do X', planning: 'chat' }
    })
    expect(intakeRequest(form({ text: '1. a', fixlist: true }))?.args).toMatchObject({ mode: 'fixlist' })
  })
  // T4
  it('sends --planning chat|auto', () => {
    expect(intakeRequest(form({ text: 'x', planning: 'chat' }))?.args).toMatchObject({ planning: 'chat' })
    expect(intakeRequest(form({ text: 'x', planning: 'auto' }))?.args).toMatchObject({ planning: 'auto' })
  })
  it('chat may start with nothing typed (no objective sent); planning alone needs text', () => {
    const args = intakeRequest(form())?.args
    expect(args).toMatchObject({ planning: 'chat' })
    expect(args).not.toHaveProperty('objective')
    expect(intakeRequest(form({ planning: 'auto' }))).toBeNull()
  })
  it('works with no account picked: the Host chooses', () => {
    const args = intakeRequest(form({ text: 'x', coordinatorAccount: '' }))?.args
    expect(args).toMatchObject({ cwd: '/repo', planning: 'chat' })
    expect(args).not.toHaveProperty('coordinatorAccount')
  })
  it('Files attaches the dropped paths', () => {
    expect(intakeRequest(form({ tab: 'files', files: ['/d/a.pdf'] }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, attach: ['/d/a.pdf'], planning: 'chat' }
    })
  })
  it('sends priority to jobs-create only when it is not 0', () => {
    expect(intakeRequest(form({ text: 'x', priority: 0 }))?.args).not.toHaveProperty('priority')
    expect(intakeRequest(form({ text: 'x', priority: 1 }))?.args).toMatchObject({ priority: 1 })
    expect(intakeRequest(form({ tab: 'prompts', files: ['/a.md'], priority: -1 }))?.args).toMatchObject({ priority: -1 })
  })
  // W8-C prompts mode
  it('Run as written sends --mode prompts with the .md files, else the pasted document; ask only when ticked; no planning', () => {
    expect(intakeRequest(form({ tab: 'prompts', files: ['/d/W9-A.md'], text: 'ignored' }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, mode: 'prompts', attach: ['/d/W9-A.md'] }
    })
    const doc = intakeRequest(form({ tab: 'prompts', text: '## a\nx\n## b\ny', approveAsk: true }))?.args
    expect(doc).toMatchObject({ mode: 'prompts', objective: '## a\nx\n## b\ny', approve: 'ask' })
    expect(doc).not.toHaveProperty('planning')
    expect(intakeRequest(form({ tab: 'prompts' }))).toBeNull()
  })
  it('W7-D (#67): sends the worker count the owner picked, on every tab', () => {
    for (const f of [form({ text: 'x' }), form({ tab: 'files', files: ['/a'] }), form({ tab: 'prompts', text: 'x' })])
      expect(intakeRequest({ ...f, concurrency: 10 })?.args).toMatchObject({ concurrency: 10 })
  })
  it('is null without a project or the tab’s source', () => {
    for (const f of [form({ text: 'x', project: null }), form({ tab: 'files' }), form({ tab: 'prompts' })]) expect(intakeRequest(f)).toBeNull()
  })
})
