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
    expect(html).toContain('+ npm test')
    expect(html).toContain('+ Plugin: Debug leftovers')
    expect(html).not.toContain('jobs.task.checksRuntimePlugins')
  })

  it('a Runtime’s Task says its plugin checks are added from the CLI', () => {
    expect(render(door('rt_1'), [])).toContain('jobs.task.checksRuntimePlugins')
  })
})
