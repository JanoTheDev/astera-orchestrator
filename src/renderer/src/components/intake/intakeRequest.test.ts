import { describe, expect, it } from 'vitest'
import { fileUnderArgs, intakeRequest, type IntakeForm } from './intakeRequest'

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
  effort: '',
  delivery: 'pr',
  replan: 'waves',
  handsOff: false,
  ...o
})

const settings = { delivery: 'pr', handsOff: 'off' }

describe('intakeRequest', () => {
  it('Describe makes jobs-create, fixlist when the text is a problem list, with the extra instructions', () => {
    expect(intakeRequest(form({ text: ' Do X ', instructions: ' no deps ' }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, instructions: 'no deps', ...settings, objective: 'Do X', replan: 'waves', planning: 'chat' }
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
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, ...settings, replan: 'waves', attach: ['/d/a.pdf'], planning: 'chat' }
    })
  })
  it('sends priority to jobs-create only when it is not 0', () => {
    expect(intakeRequest(form({ text: 'x', priority: 0 }))?.args).not.toHaveProperty('priority')
    expect(intakeRequest(form({ text: 'x', priority: 1 }))?.args).toMatchObject({ priority: 1 })
    expect(intakeRequest(form({ tab: 'prompts', files: ['/a.md'], priority: -1 }))?.args).toMatchObject({ priority: -1 })
  })
  // W8-C prompts mode
  it('Run as written sends --mode prompts with the .md files, else the pasted document; no planning, and no approval (the project decides)', () => {
    expect(intakeRequest(form({ tab: 'prompts', files: ['/d/W9-A.md'], text: 'ignored' }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, ...settings, mode: 'prompts', attach: ['/d/W9-A.md'] }
    })
    const doc = intakeRequest(form({ tab: 'prompts', text: '## a\nx\n## b\ny' }))?.args
    expect(doc).toMatchObject({ mode: 'prompts', objective: '## a\nx\n## b\ny' })
    expect(doc).not.toHaveProperty('approve')
    expect(doc).not.toHaveProperty('autoApprove')
    expect(doc).not.toHaveProperty('planning')
    expect(intakeRequest(form({ tab: 'prompts' }))).toBeNull()
  })
  it('W7-D (#67): sends the worker count the owner picked, on every tab', () => {
    for (const f of [form({ text: 'x' }), form({ tab: 'files', files: ['/a'] }), form({ tab: 'prompts', text: 'x' })])
      expect(intakeRequest({ ...f, concurrency: 10 })?.args).toMatchObject({ concurrency: 10 })
  })
  // T17
  it('sends every setting to jobs-create: effort when picked, delivery and hands-off always, replan unless Run as written', () => {
    const tabs = [form({ text: 'x' }), form({ tab: 'files', files: ['/a.pdf'] }), form({ tab: 'prompts', text: 'x' }), form({ tab: 'prompts', files: ['/a.md'] })]
    for (const f of tabs) {
      const args = intakeRequest({ ...f, effort: 'high', delivery: 'merge', handsOff: true, replan: 'off', coordinatorAccount: 'acc2', concurrency: 7 })?.args
      expect(args).toMatchObject({ effort: 'high', delivery: 'merge', handsOff: 'on', coordinatorAccount: 'acc2', concurrency: 7 })
      if (f.tab === 'prompts') expect(args).not.toHaveProperty('replan')
      else expect(args).toMatchObject({ replan: 'off' })
    }
    const auto = intakeRequest(form({ text: 'x' }))?.args
    expect(auto).not.toHaveProperty('effort')
    expect(auto).toMatchObject({ delivery: 'pr', handsOff: 'off' })
  })
  it('is null without a project or the tab’s source', () => {
    for (const f of [form({ text: 'x', project: null }), form({ tab: 'files' }), form({ tab: 'prompts' })]) expect(intakeRequest(f)).toBeNull()
  })
})

// T17
describe('fileUnderArgs', () => {
  it('moves a Job the Host filed under the workspace to the sub-project picked by id', () => {
    expect(fileUnderArgs({ id: 'j1', projectId: 'ws' }, 'ws-api')).toEqual({ id: 'j1', project: 'ws-api' })
  })
  it('leaves a Job that is already there, or that the Host filed under no project', () => {
    expect(fileUnderArgs({ id: 'j1', projectId: 'ws' }, 'ws')).toBeNull()
    expect(fileUnderArgs({ id: 'j1' }, 'ws-api')).toBeNull()
    expect(fileUnderArgs({ id: 'j1', projectId: 'ws' }, '')).toBeNull()
  })
})
