import { describe, expect, it } from 'vitest'
import type { OrchDoor } from '../../lib/orchDoor'
import { createPlan } from './createPlan'

const t = (k: string): string => k

function door(fail: Record<string, { status: number; body?: unknown }>) {
  const sent: Array<{ cmd: string; args: Record<string, unknown> }> = []
  const d = {
    command: async (cmd: string, args: Record<string, unknown>) => {
      sent.push({ cmd, args })
      return fail[cmd] ?? (cmd === 'jobs-create' ? { status: 200, body: { id: 'j1', projectId: 'p1' } } : { status: 200, body: {} })
    }
  } as unknown as OrchDoor
  return { d, sent }
}

const opts = { cmd: 'jobs-create', args: { objective: 'x' }, projectId: 'p1', after: '', scheduled: false, t }

describe('createPlan', () => {
  it('deletes the made Job when the planner does not start, and says why', async () => {
    const { d, sent } = door({ 'jobs-plan': { status: 409, body: { error: 'no room' } } })
    expect(await createPlan(d, opts)).toEqual({ ok: false, error: 'jobs.new.plannerFailed: no room' })
    expect(sent.map((s) => s.cmd)).toEqual(['jobs-create', 'jobs-plan', 'run-delete'])
    expect(sent[2].args).toEqual({ id: 'j1' })
  })

  it('deletes the made Job when the queued-after jobs-set fails', async () => {
    const { d, sent } = door({ 'jobs-set': { status: 400, body: { error: 'bad' } } })
    expect((await createPlan(d, { ...opts, after: 'j0' })).ok).toBe(false)
    expect(sent.map((s) => s.cmd)).toEqual(['jobs-create', 'jobs-set', 'run-delete'])
  })

  it('deletes the made Job when the file-under move fails, before any planner', async () => {
    const { d, sent } = door({ 'jobs-set': { status: 500 } })
    expect((await createPlan(d, { ...opts, projectId: 'p2' })).ok).toBe(false)
    expect(sent.map((s) => s.cmd)).toEqual(['jobs-create', 'jobs-set', 'run-delete'])
  })

  it('keeps the original error when the delete fails too', async () => {
    const { d } = door({ 'jobs-plan': { status: 409, body: { error: 'no room' } }, 'run-delete': { status: 409 } })
    expect(await createPlan(d, opts)).toEqual({ ok: false, error: 'jobs.new.plannerFailed: no room' })
  })

  it('keeps the Job when the planner starts, waits for an account, or the Job is scheduled', async () => {
    const started = door({ 'jobs-plan': { status: 200, body: { sessionId: 's1' } } })
    expect(await createPlan(started.d, opts)).toEqual({ ok: true, id: 'j1', sessionId: 's1' })
    const waiting = door({ 'jobs-plan': { status: 202, body: { waiting: true } } })
    expect(await createPlan(waiting.d, opts)).toEqual({ ok: true, id: 'j1' })
    const sched = door({})
    expect(await createPlan(sched.d, { ...opts, scheduled: true })).toEqual({ ok: true, id: 'j1' })
    for (const x of [started, waiting, sched]) expect(x.sent.map((s) => s.cmd)).not.toContain('run-delete')
  })
})
