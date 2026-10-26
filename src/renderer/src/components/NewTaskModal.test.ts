// The new-Task window's checks (plugin Phase 5 C6, C14): a plugin's check is offered beside the run configurations;
// a Runtime's Task is told where its plugin checks are added.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OrchDoor } from '../lib/orchDoor'

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'en', t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key) })
}))
const { NewTaskModal } = await import('./NewTaskModal')

const door = (runtimeId?: string): OrchDoor => ({ ...(runtimeId ? { runtimeId } : {}), projectKey: '/repo', readOnlyReason: null }) as unknown as OrchDoor
const render = (d: OrchDoor, runConfigs: { id: string; name: string }[]): string =>
  renderToStaticMarkup(React.createElement(NewTaskModal, { door: d, runId: 'run_1', tasks: [], accounts: [], runConfigs, onClose: () => {}, onCreated: () => {} }))

describe('NewTaskModal checks', () => {
  it('offers a plugin check beside the run configurations', () => {
    const html = render(door(), [
      { id: 'cfg_t', name: 'npm test' },
      { id: 'plugin:astera-debug-leftovers', name: 'Plugin: Debug leftovers' }
    ])
    expect(html).toMatch(/detail-check-add[^>]*>.*?<span class="ui-btn__label">npm test<\/span>/)
    expect(html).toMatch(/detail-check-add[^>]*>.*?<span class="ui-btn__label">Plugin: Debug leftovers<\/span>/)
    expect(html).not.toContain('jobs.task.checksRuntimePlugins')
  })

  // 5c final review M8: the command it gives runs as written: this Runtime and this run, and the work it needs
  it('a Runtime’s Task says its plugin checks are added from the CLI, naming this Runtime and this run', () => {
    expect(render(door('rt_1'), [])).toContain('jobs.task.checksRuntimePlugins {&quot;runtime&quot;:&quot;rt_1&quot;,&quot;run&quot;:&quot;run_1&quot;}')
  })

  // The account is Auto (most room) and folded: a Task is made without picking one
  it('opens on Auto with the account picker folded, and warns instead when no account is registered', () => {
    const acct = { id: 'a1', label: 'Main', configDir: '/c', color: '', createdAt: '', provider: 'claude' as const }
    const withAccounts = renderToStaticMarkup(
      React.createElement(NewTaskModal, { door: door(), runId: 'run_1', tasks: [], accounts: [acct], runConfigs: [], onClose: () => {}, onCreated: () => {} })
    )
    expect(withAccounts).toContain('aria-expanded="false"')
    expect(withAccounts).toContain('accounts.auto')
    expect(withAccounts).not.toContain('id="task-accounts"')
    expect(render(door(), [])).toContain('jobs.task.accountEmpty')
  })
})

describe('NewTaskModal initialDeps', () => {
  it('starts with the given Tasks as dependency chips', () => {
    const tasks = [{ id: 't1', title: 'Prev step task', status: 'completed', openGates: 0 }]
    const html = renderToStaticMarkup(
      React.createElement(NewTaskModal, { door: door(), runId: 'run_1', tasks, accounts: [], runConfigs: [], initialDeps: ['t1'], onClose: () => {}, onCreated: () => {} } as never)
    )
    expect(html).toMatch(/detail-dep[^>]*>.*Prev step task/)
  })
})

describe('NewTaskModal AI-first', () => {
  const planned = (): string =>
    renderToStaticMarkup(React.createElement(NewTaskModal, { door: door(), runId: 'run_1', tasks: [], accounts: [], runConfigs: [], planned: true, onClose: () => {}, onCreated: () => {} }))
  it('a planned plan opens on one box with Add with AI, the manual fields hidden', () => {
    const html = planned()
    expect(html).toContain('jobs.task.addWithAi')
    expect(html).toContain('jobs.task.writeMyself')
    expect(html).not.toContain('jobs.task.title')
    expect(html).not.toContain('jobs.task.create')
  })
  it('a plan without a planner opens on the manual form with a hint', () => {
    const html = render(door(), [])
    expect(html).toContain('jobs.task.noPlannerHint')
    expect(html).toContain('jobs.task.create')
    expect(html).not.toContain('jobs.task.addWithAi')
  })
})

describe('NewTaskModal plan fields (T2)', () => {
  it('offers the prompt, criteria and kind, and Ask the planner instead', () => {
    const html = render(door(), [])
    expect(html).toContain('plan.edit.field.prompt')
    expect(html).toContain('plan.edit.field.criteria')
    expect(html).toContain('plan.edit.field.kind')
    expect(html).toContain('jobs.task.askPlanner')
    // difficulty and affected paths are the edit form's only
    expect(html).not.toContain('plan.edit.field.difficulty')
  })
})
