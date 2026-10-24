// `run-configs add` through handleCommand: the argument checks live here, the validation and the file in
// core/run/runConfigsFile.test.ts.
import { describe, it, expect, vi } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState } from './state'
import { HOST_CALLER } from '../host/driver'

const saved = { id: 'user:1', name: 'Test', type: 'shell', command: 'npm test' }

const call = (args: Record<string, unknown>, addRunConfig?: unknown) =>
  handleCommand(
    { getState: () => emptyState(), setState: async () => {}, now: () => 'x', ...(addRunConfig ? { addRunConfig } : {}) } as unknown as OrchServerDeps,
    { sessionId: HOST_CALLER },
    'run-configs-add',
    args
  )

describe('run-configs-add', () => {
  const config = JSON.stringify({ name: 'Test', type: 'shell', command: 'npm test' })

  it('hands the parsed configuration to the dep and answers the saved one', async () => {
    const add = vi.fn().mockResolvedValue({ ok: true, config: saved, replaced: true })
    const out = await call({ project: '/p', config }, add)
    expect(add).toHaveBeenCalledWith('/p', { name: 'Test', type: 'shell', command: 'npm test' })
    expect(out).toEqual({ status: 200, body: { config: saved, replaced: true } })
  })

  it('refuses with the reason when the validation says no', async () => {
    const add = vi.fn().mockResolvedValue({ ok: false, errors: [{ id: 'seed:x', reason: 'INVALID_CONFIG' }] })
    const out = await call({ project: '/p', config }, add)
    expect(out.status).toBe(400)
    expect(JSON.stringify(out.body)).toContain('seed:x')
  })

  it.each([
    ['no project', { config }],
    ['a relative project', { project: 'p', config }],
    ['no config', { project: '/p' }],
    ['config that is not JSON', { project: '/p', config: '{nope' }]
  ])('answers 400 for %s', async (_n, args) => {
    const add = vi.fn()
    expect((await call(args, add)).status).toBe(400)
    expect(add).not.toHaveBeenCalled()
  })

  it('answers 409 where nothing can save it', async () => {
    expect((await call({ project: '/p', config })).status).toBe(409)
  })
})
