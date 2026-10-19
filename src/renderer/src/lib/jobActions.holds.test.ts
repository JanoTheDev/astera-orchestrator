// W5-C: approving starts workers, so every door to `run-start` on a plan asks first (#40: the Run window's Run button
// did not), and the hold actions send exactly their command.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OrchDoor } from './orchDoor'
import { approvePlan, holdJob, holdWorker, unholdWorker, type ActionUi } from './jobActions'

const harness = (confirm: boolean, reply: { status: number; body: unknown } = { status: 200, body: {} }) => {
  const sent: Array<[string, Record<string, unknown>]> = []
  const asked: string[] = []
  const errors: string[] = []
  const door = {
    command: async (cmd: string, args: Record<string, unknown>) => {
      sent.push([cmd, args])
      return reply
    }
  } as unknown as OrchDoor
  const ui: ActionUi = {
    t: (k) => k,
    confirm: async (o) => {
      asked.push(o.title)
      return confirm
    },
    confirmChoices: async () => ({ ok: confirm, checked: [] }),
    error: (m) => void errors.push(m)
  }
  return { door, ui, sent, asked, errors }
}

describe('approvePlan', () => {
  it('asks first and sends nothing when declined', async () => {
    const h = harness(false)
    expect(await approvePlan(h.door, 'job_1', 'Console', h.ui)).toBe(false)
    expect(h.asked).toEqual(['jobs.run.approve'])
    expect(h.sent).toEqual([])
  })

  it('sends run-start once confirmed, and says the problems of a plan that does not hold', async () => {
    const h = harness(true, { status: 400, body: { error: 'x', problems: ['Task A has no prompt'] } })
    expect(await approvePlan(h.door, 'job_1', 'Console', h.ui)).toBe(false)
    expect(h.sent).toEqual([['run-start', { run: 'job_1' }]])
    expect(h.errors[0]).toContain('Task A has no prompt')
  })

  it("is the Run window's Run button too (#40): it sends no run-start of its own", () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../components/plan/planCommands.ts'), 'utf8')
    const start = src.slice(src.indexOf('const startRunNow'), src.indexOf('const mergeRunNow'))
    expect(start).toContain('approvePlan(')
    expect(start).not.toContain("'run-start'")
  })
})

describe('holds (#38, #39)', () => {
  it('holdJob sends jobs-hold or jobs-unhold and asks nothing', async () => {
    const h = harness(false)
    expect(await holdJob(h.door, 'job_1', true, h.ui)).toBe(true)
    expect(await holdJob(h.door, 'job_1', false, h.ui)).toBe(true)
    expect(h.sent).toEqual([
      ['jobs-hold', { id: 'job_1' }],
      ['jobs-unhold', { id: 'job_1' }]
    ])
    expect(h.asked).toEqual([])
  })

  it('holdWorker asks first; unholdWorker does not', async () => {
    const no = harness(false)
    expect(await holdWorker(no.door, 'd1', 'Trading Worker 2', no.ui)).toBe(false)
    expect(no.sent).toEqual([])
    const yes = harness(true)
    expect(await holdWorker(yes.door, 'd1', 'Trading Worker 2', yes.ui)).toBe(true)
    expect(await unholdWorker(yes.door, 'd1', yes.ui)).toBe(true)
    expect(yes.sent).toEqual([
      ['worker-hold', { dispatch: 'd1' }],
      ['worker-unhold', { dispatch: 'd1' }]
    ])
    expect(yes.asked).toEqual(['command.holdWorker.title'])
  })

  it('a refused hold is said', async () => {
    const h = harness(true, { status: 403, body: { error: 'no' } })
    expect(await holdJob(h.door, 'job_1', true, h.ui)).toBe(false)
    expect(h.errors).toHaveLength(1)
  })
})
