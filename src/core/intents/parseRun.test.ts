import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../types'
import { parseWithCoordinator } from './parseRun'
import { parsePrompt } from './prompt'

const account = { id: 'a1', provider: 'claude', configDir: '/tmp/cfg', label: 'A' } as unknown as Account

describe('parseWithCoordinator', () => {
  it('runs on the coordinator model, never the planner model', async () => {
    const run = vi.fn(async () => ({ ok: true as const, value: { kind: 'waiting' } }))
    const r = await parseWithCoordinator({ account, descriptors: {} as never, roleModels: {}, cwd: '/tmp', prompt: 'p', run })
    expect(r).toEqual({ ok: true, intent: { kind: 'waiting' }, model: 'haiku' })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ generator: { model: 'haiku' }, prompt: 'p' }))
    // An owner override of the coordinator role is what runs, and the planner's setting never is
    await parseWithCoordinator({
      account,
      descriptors: {} as never,
      roleModels: { claude: { roles: { coordinator: 'sonnet', planner: 'opus' } } },
      cwd: '/tmp',
      prompt: 'p',
      run
    })
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ generator: { model: 'sonnet' } }))
  })

  it('treats an answer that is not an intent as a failure, not a command', async () => {
    const run = vi.fn(async () => ({ ok: true as const, value: { kind: 'shell', cmd: 'rm' } }))
    expect(await parseWithCoordinator({ account, descriptors: {} as never, roleModels: {}, cwd: '/tmp', prompt: 'p', run })).toMatchObject({
      ok: false
    })
  })
})

describe('parsePrompt', () => {
  it('names the plans and sessions and quotes the command as data', () => {
    const p = parsePrompt('pause "x"', {
      projects: [{ id: 'g', name: 'Gameful', path: '/g' }],
      plans: [
        {
          jobId: 'j',
          name: 'Trading',
          projectId: 'g',
          projectName: 'Gameful',
          projectPath: '/g',
          scheduled: false,
          pendingStart: true,
          sessions: [{ sessionId: 's', role: 'worker', label: 'Trading Worker 1', taskTitle: 'API' }]
        }
      ],
      currentProjectPath: '/g',
      currentPlanId: null
    }, [{ jobId: 'j', status: 'not started' }])
    expect(p).toContain('Gameful › Trading [not started] — not started')
    expect(p).toContain('Trading Worker 1 (API)')
    expect(p).toContain('Command: "pause \\"x\\""')
    expect(p).toContain('Open project: Gameful.')
  })
})
