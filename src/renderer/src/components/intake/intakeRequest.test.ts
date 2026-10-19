import { describe, expect, it } from 'vitest'
import { AUDIT_FOCUSES, allSelected, autoPickRequest, intakeRequest, issueSearchArgs, toggleAll, type IntakeForm } from './intakeRequest'

const form = (o: Partial<IntakeForm> = {}): IntakeForm => ({
  tab: 'describe',
  text: '',
  fixlist: false,
  files: [],
  scope: [],
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
    expect(intakeRequest(form({ tab: 'audit', scope: ['src/core'] }))?.args).toMatchObject({ scope: 'src/core' })
  })
  // T2 Audit mode
  it('Audit joins several paths and sends focus only when it differs from the default', () => {
    expect(intakeRequest(form({ tab: 'audit', scope: ['src/core', 'src/main'], text: ' the IPC ' }))).toEqual({
      cmd: 'jobs-create',
      args: { cwd: '/repo', coordinatorAccount: 'acc1', concurrency: 3, objective: 'the IPC', mode: 'audit', scope: 'src/core,src/main' }
    })
    expect(intakeRequest(form({ tab: 'audit', focus: ['tests', 'bugs', 'security'] }))?.args).not.toHaveProperty('focus')
    expect(intakeRequest(form({ tab: 'audit', focus: [] }))?.args).not.toHaveProperty('focus')
    expect(intakeRequest(form({ tab: 'audit', focus: ['performance', 'simplify'] }))?.args).toMatchObject({ focus: 'performance,simplify' })
    expect(intakeRequest(form({ tab: 'audit', focus: ['bugs', 'security'] }))?.args).toMatchObject({ focus: 'bugs,security' })
  })
  it('offers the focus values jobs-create takes', async () => {
    // a variable path: the web typecheck cannot follow intake.ts's node-only imports, vitest can
    const intake = '../../../../core/orchestration/intake'
    expect([...AUDIT_FOCUSES]).toEqual((await import(intake)).INTAKE_FOCUSES)
  })
  it('sends priority to jobs-create only when it is not 0', () => {
    expect(intakeRequest(form({ text: 'x', priority: 0 }))?.args).not.toHaveProperty('priority')
    expect(intakeRequest(form({ text: 'x', priority: 2 }))?.args).toMatchObject({ priority: 2 })
    expect(intakeRequest(form({ tab: 'prompts', files: ['/a.md'], priority: -1 }))?.args).toMatchObject({ priority: -1 })
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

describe('issueSearchArgs (#119)', () => {
  it('sends the assignee filter and the trimmed search', () => {
    expect(issueSearchArgs({ projectId: 'p1', query: '  bug ', assignee: 'others' })).toEqual({ source: 'github', project: 'p1', query: 'bug', assignee: 'others' })
    expect(issueSearchArgs({ projectId: 'p1', query: ' ', assignee: 'none' })).toEqual({ source: 'github', project: 'p1', assignee: 'none' })
  })
})

describe('autoPickRequest (#119)', () => {
  const base = { project: { id: 'p1', path: '/repo' }, coordinatorAccount: 'acc1', concurrency: 3, instructions: '', assignMe: false, label: '', max: '' }
  it('asks Astera to pick, with label, max and hands-off only when set', () => {
    expect(autoPickRequest(base)).toEqual({ cmd: 'jobs-create-from-issue', args: { project: 'p1', auto: true, coordinatorAccount: 'acc1', concurrency: 3 } })
    expect(autoPickRequest({ ...base, label: ' bug ', max: '5', handsOff: 'on' })?.args).toMatchObject({ auto: true, label: 'bug', max: 5, handsOff: 'on' })
    expect(autoPickRequest({ ...base, max: 'x' })?.args).not.toHaveProperty('max')
  })
  it('waits for a project and a coordinator', () => {
    expect(autoPickRequest({ ...base, project: null })).toBeNull()
    expect(autoPickRequest({ ...base, coordinatorAccount: '' })).toBeNull()
  })
})

describe('Select all (#119)', () => {
  const rows = [{ id: '1' }, { id: '2', selectable: false }, { id: '3', selectable: true }]
  it('ticks only the selectable rows in view and keeps picks made elsewhere', () => {
    expect(toggleAll(rows, [])).toEqual(['1', '3'])
    expect(toggleAll(rows, ['9', '1'])).toEqual(['9', '1', '3'])
  })
  it('unticks them all when all are ticked', () => {
    expect(allSelected(rows, ['1', '3'])).toBe(true)
    expect(toggleAll(rows, ['9', '1', '3'])).toEqual(['9'])
  })
  it('is never ticked for a view with nothing to pick', () => {
    expect(allSelected([{ id: '2', selectable: false }], [])).toBe(false)
    expect(toggleAll([], ['4'])).toEqual(['4'])
  })
})
