import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Task } from '../../../../core/orchestration/types'
import type { CommandReply } from '../../lib/orchDoor'
import { placementLineOf, taskModeOf, addTaskRequestOf, attemptStateOf, canEdit, createArgsOf, draftOf, editArgsOf, feedbackTextOf, loadTaskInfo, taskEditOf, type EditableTask } from './taskEdit'

vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))
const { TaskEditModal } = await import('./TaskEditModal')

const task = (o: Partial<EditableTask> = {}): EditableTask => ({ status: 'pending', runId: 'run_1', consecutiveFailures: 0, dispatches: 0, ...o })

describe('taskEditOf mirrors editPlanTask', () => {
  it('a plan not yet started: every field', () => {
    expect(taskEditOf(task({ runId: undefined, status: 'ready' }), {})).toEqual({ fields: 'all' })
  })

  it('a running plan, a Task not started: every field', () => {
    for (const status of ['pending', 'ready', 'blocked'] as const) expect(taskEditOf(task({ status }), { outcome: 'running' })).toEqual({ fields: 'all' })
    expect(taskEditOf(task(), { outcome: 'paused' })).toEqual({ fields: 'all' })
  })

  it('a started Task (dispatched once, or moving): criteria only, said why', () => {
    const started = { fields: 'criteria', reason: 'plan.edit.why.started' }
    expect(taskEditOf(task({ status: 'ready', dispatches: 1 }), { outcome: 'running' })).toEqual(started)
    expect(taskEditOf(task({ status: 'dispatched', dispatches: 1 }), { outcome: 'running' })).toEqual(started)
    expect(taskEditOf(task({ status: 'failed', consecutiveFailures: 1, dispatches: 1 }), { outcome: 'running' })).toEqual(started)
  })

  it('a Run that is not running: criteria only', () => {
    expect(taskEditOf(task(), { outcome: 'blocked' })).toEqual({ fields: 'criteria', reason: 'plan.edit.why.notRunning' })
    expect(taskEditOf(task(), {})).toEqual({ fields: 'criteria', reason: 'plan.edit.why.notRunning' })
  })

  it('a finished Task: nothing', () => {
    const none = { fields: 'none', reason: 'plan.edit.why.finished' }
    expect(taskEditOf(task({ status: 'completed', dispatches: 1 }), { outcome: 'running' })).toEqual(none)
    expect(taskEditOf(task({ status: 'failed', consecutiveFailures: 3, dispatches: 3 }), { outcome: 'running' })).toEqual(none)
  })

  it('canEdit opens the criteria alone on a started Task', () => {
    const edit = taskEditOf(task({ dispatches: 1, status: 'dispatched' }), { outcome: 'running' })
    expect(canEdit(edit, 'criteria')).toBe(true)
    expect(canEdit(edit, 'title')).toBe(false)
    expect(canEdit({ fields: 'none', reason: 'plan.edit.why.finished' }, 'criteria')).toBe(false)
  })
})

describe('editArgsOf sends only what changed', () => {
  const before = draftOf({ title: 'A', spec: 'S', deps: ['t1'], prompt: 'P', acceptanceCriteria: ['c1', 'c2'], kind: 'ui', affectedPaths: ['a.ts'] })

  it('nothing changed: nothing sent', () => {
    expect(editArgsOf(before, { ...before, criteria: ' c1 \n\nc2\n' })).toEqual({})
  })

  it('the criteria alone, as a list', () => {
    expect(editArgsOf(before, { ...before, criteria: 'c1\nc3' })).toEqual({ criteria: ['c1', 'c3'] })
  })

  it('every changed field by its task-update name; an emptied prompt or kind is not sent', () => {
    const after = { ...before, title: 'B', spec: 'S2', prompt: '', deps: [], kind: '', difficulty: 'hard', affectedPaths: 'a.ts\nb.ts' }
    expect(editArgsOf(before, after)).toEqual({ title: 'B', spec: 'S2', deps: [], difficulty: 'hard', affectedPaths: ['a.ts', 'b.ts'] })
  })

  it('effort is sent when chosen and left out when emptied', () => {
    const had = { ...before, effort: 'low' }
    expect(editArgsOf(before, { ...before, effort: 'high' })).toEqual({ effort: 'high' })
    expect(editArgsOf(had, { ...had, effort: '' })).toEqual({})
  })
})

describe('createArgsOf and feedbackTextOf', () => {
  it('only the filled plan fields', () => {
    expect(createArgsOf('', ' \n', '')).toEqual({})
    expect(createArgsOf(' do it ', 'one\ntwo', 'docs')).toEqual({ prompt: 'do it', criteria: ['one', 'two'], kind: 'docs' })
  })

  it('names the Task by title and id', () => {
    const text = feedbackTextOf({ id: 'tsk_1', title: 'Fix login' }, ' split it in two ')
    expect(text).toContain('"Fix login"')
    expect(text).toContain('tsk_1')
    expect(text.endsWith('split it in two')).toBe(true)
  })
})

describe('attemptStateOf', () => {
  it('its outcome, else stopped once ended, else running', () => {
    expect(attemptStateOf({ outcome: 'failed', endedAt: 'x' })).toBe('failed')
    expect(attemptStateOf({ endedAt: 'x' })).toBe('stopped')
    expect(attemptStateOf({})).toBe('running')
  })
})

describe('addTaskRequestOf', () => {
  it('asks to add the typed Task, its title when given', () => {
    expect(addTaskRequestOf(' Docs ', ' Write the guide ')).toBe('Add a task to the plan: "Docs".\n\nWrite the guide')
    expect(addTaskRequestOf('', 'Write it')).toBe('Add a task to the plan.\n\nWrite it')
  })
})

describe('loadTaskInfo', () => {
  const door = (replies: Record<string, CommandReply>) => {
    const calls: Array<[string, Record<string, unknown>]> = []
    return { calls, command: async (cmd: string, args: Record<string, unknown>) => (calls.push([cmd, args]), replies[cmd] ?? { status: 404, body: {} }) }
  }

  it('reads the Task, its plan’s full record and its Run’s outcome', async () => {
    const d = door({
      'tasks-get': { status: 200, body: { id: 't1', runId: 'run_1', attempts: [{ id: 'd1' }] } },
      'tasks-list': { status: 200, body: [{ id: 't0' }, { id: 't1', prompt: 'P' }] },
      'runs-get': { status: 200, body: { outcome: 'running' } }
    })
    const info = await loadTaskInfo(d, 't1')
    expect(info).toEqual({ task: { id: 't1', prompt: 'P' }, attempts: [{ id: 'd1' }], outcome: 'running' })
    expect(d.calls).toContainEqual(['tasks-list', { run: 'run_1' }])
  })

  it('a plan’s own Task reads by its Job and has no Run; a refusal is null', async () => {
    const d = door({ 'tasks-get': { status: 200, body: { id: 't1', jobId: 'job_1', attempts: [] } }, 'tasks-list': { status: 200, body: [{ id: 't1' }] } })
    expect(await loadTaskInfo(d, 't1')).toEqual({ task: { id: 't1' }, attempts: [] })
    expect(d.calls.map((c) => c[0])).not.toContain('runs-get')
    expect(await loadTaskInfo(door({}), 't1')).toBeNull()
  })
})

describe('TaskEditModal', () => {
  const full = { id: 't1', title: 'A', spec: 'S', deps: [], status: 'dispatched', consecutiveFailures: 0, createdAt: '', updatedAt: '', acceptanceCriteria: ['c1'] } as Task
  const modal = (edit: Parameters<typeof TaskEditModal>[0]['edit']): string =>
    renderToStaticMarkup(React.createElement(TaskEditModal, { door: {} as never, task: full, tasks: [], edit, onClose: () => {}, onSaved: () => {} }))

  it('a started Task: only the criteria are enabled, the others disabled with the reason shown', () => {
    const html = modal({ fields: 'criteria', reason: 'plan.edit.why.started' })
    expect(html).toContain('plan.edit.why.started')
    const textareas = html.match(/<textarea[^>]*>/g) ?? []
    // spec, prompt, criteria, affected paths: only the criteria one is enabled
    expect(textareas).toHaveLength(4)
    expect(textareas.filter((x) => !x.includes('disabled'))).toHaveLength(1)
    expect(html).toMatch(/<input[^>]*disabled[^>]*title="plan.edit.why.started"/)
  })

  it('a Task not started: every field enabled, no reason', () => {
    const html = modal({ fields: 'all' })
    expect(html).not.toContain('plan.edit.why')
    expect((html.match(/<textarea[^>]*>/g) ?? []).every((x) => !x.includes('disabled'))).toBe(true)
  })
})

describe('Add task window helpers', () => {
  const tasks = [{ id: 't1', title: 'Build API' }, { id: 't2', title: 'Docs' }]
  it('opens on the planner box only for a planned plan', () => {
    expect(taskModeOf(true)).toBe('ai')
    expect(taskModeOf(false)).toBe('manual')
    expect(taskModeOf(undefined)).toBe('manual')
  })
  it('names the Tasks to place the new one after', () => {
    expect(placementLineOf([], tasks)).toBe('')
    expect(placementLineOf(['t1', 't2', 'gone'], tasks)).toBe('Place it after: "Build API" (t1), "Docs" (t2), gone')
  })
  it('adds the placement line to the request', () => {
    expect(addTaskRequestOf('', ' dark mode ', 'Place it after: x')).toBe('Add a task to the plan.\n\ndark mode\n\nPlace it after: x')
    expect(addTaskRequestOf('', 'dark mode')).toBe('Add a task to the plan.\n\ndark mode')
  })
})
