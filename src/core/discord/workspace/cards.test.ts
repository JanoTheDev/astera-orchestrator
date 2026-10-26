import { describe, it, expect } from 'vitest'
import { emptyState, type OrchState } from '../../orchestration/state'
import type { Gate, Job, JobRun, Task, TaskStatus } from '../../orchestration/types'
import { EMBED_LIMITS, embedSize, gateMessage, noticeText, planCard, planStateOf } from './cards'
import { parseCustomId } from './ids'

const job = (over: Partial<Job> = {}): Job => ({ id: 'job_1', objective: 'Ship the Discord workspace', cwd: '/repo', createdAt: '2026-10-01T00:00:00Z', ...over })
const task = (i: number, status: TaskStatus, over: Partial<Task> = {}): Task => ({
  id: `tsk_${i}`,
  jobId: 'job_1',
  title: `Task ${i}`,
  spec: '',
  deps: [],
  status,
  consecutiveFailures: 0,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over
})
const stateWith = (over: Partial<OrchState>): OrchState => ({ ...emptyState(), ...over })

type Embed = { title?: string; description?: string; fields?: Array<{ name: string; value: string }>; footer?: { text: string } }
type Row = { type: number; components: Array<{ type: number; custom_id?: string; label?: string; options?: Array<{ value: string }> }> }
const embedOf = (b: { embeds?: unknown[] }): Embed => b.embeds![0] as Embed
const rowsOf = (b: { components?: unknown[] }): Row[] => (b.components ?? []) as Row[]
const buttons = (b: { components?: unknown[] }) => rowsOf(b).flatMap((r) => r.components)

describe('planCard', () => {
  it('is null for a plan that is gone', () => {
    expect(planCard(emptyState(), 'job_x', 'en')).toBeNull()
  })

  it('shows the name, the state and every Task, and never pings', () => {
    const s = stateWith({ jobs: [job({ title: 'Discord' })], tasks: [task(1, 'completed'), task(2, 'pending')] })
    const card = planCard(s, 'job_1', 'en')!
    const e = embedOf(card)
    expect(e.title).toBe('Discord')
    expect(e.description).toContain('Ship the Discord workspace')
    expect(e.fields!.map((f) => f.value).join('\n')).toContain('Task 2')
    expect(card.allowed_mentions).toEqual({ parse: [] })
  })

  it('offers Approve & execute only while the plan awaits approval, Talk to the planner always', () => {
    const running = stateWith({ jobs: [job()], runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: 'x' } as JobRun], tasks: [task(1, 'dispatched', { runId: 'run_1', jobId: undefined })] })
    expect(buttons(planCard(running, 'job_1', 'en')!).map((c) => parseCustomId(c.custom_id)?.action)).toEqual(['feedback'])

    const valid = task(1, 'pending', { prompt: 'do it', acceptanceCriteria: ['done'], basis: { state: 'missing', evidence: 'none yet' }, affectedPaths: ['a.ts'] })
    const awaiting = stateWith({ jobs: [job({ pendingStart: true, plannerSessionIds: ['s1'], planReadyAt: 'x' })], tasks: [valid] })
    expect(planStateOf(awaiting, awaiting.jobs[0])).toBe('approve')
    expect(buttons(planCard(awaiting, 'job_1', 'en')!).map((c) => parseCustomId(c.custom_id))).toEqual([
      { action: 'approve', id: 'job_1' },
      { action: 'feedback', id: 'job_1' }
    ])

    const planning = stateWith({ jobs: [job({ pendingStart: true, plannerSessionIds: ['s1'] })] })
    expect(planStateOf(planning, planning.jobs[0])).toBe('planning')
    expect(buttons(planCard(planning, 'job_1', 'en')!).map((c) => parseCustomId(c.custom_id)?.action)).toEqual(['feedback'])
  })

  it('stays within Discord embed limits for a plan with 60 long Tasks and a long objective', () => {
    const tasks = Array.from({ length: 60 }, (_, i) => task(i, 'pending', { title: `${'Long title '.repeat(30)}${i}` }))
    const s = stateWith({ jobs: [job({ objective: 'x'.repeat(10_000), title: 'T'.repeat(500) })], tasks })
    const e = embedOf(planCard(s, 'job_1', 'en')!)
    expect(e.title!.length).toBeLessThanOrEqual(EMBED_LIMITS.title)
    expect(e.description!.length).toBeLessThanOrEqual(EMBED_LIMITS.description)
    expect(e.fields!.length).toBeLessThanOrEqual(EMBED_LIMITS.fields)
    for (const f of e.fields!) {
      expect(f.name.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldName)
      expect(f.value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue)
      expect(f.value.length).toBeGreaterThan(0)
    }
    expect(embedSize(e)).toBeLessThanOrEqual(EMBED_LIMITS.total)
    // what did not fit is counted, not dropped silently
    expect(JSON.stringify(e)).toMatch(/and \d+ more/)
  })

  it('lists all 60 short Tasks', () => {
    const s = stateWith({ jobs: [job()], tasks: Array.from({ length: 60 }, (_, i) => task(i, 'completed')) })
    const e = embedOf(planCard(s, 'job_1', 'en')!)
    const text = e.fields!.map((f) => f.value).join('\n')
    expect(text).toContain('Task 0')
    expect(text).toContain('Task 59')
    expect(embedSize(e)).toBeLessThanOrEqual(EMBED_LIMITS.total)
  })
})

describe('gateMessage', () => {
  const gate = (options?: string[]): Gate => ({ id: 'gat_1', runId: 'run_1', taskId: 'tsk_1', question: 'Which way?', options, status: 'open', createdAt: 'x' })

  it('has one button per option and an Other answer button', () => {
    const m = gateMessage(gate(['A', 'B', 'C', 'D', 'E', 'F']), 'en')
    const rows = rowsOf(m)
    expect(rows.every((r) => r.components.length <= 5)).toBe(true)
    const ids = buttons(m).map((c) => parseCustomId(c.custom_id))
    expect(ids.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5].map((n) => ({ action: 'gate', id: 'gat_1', n })))
    expect(ids.at(-1)).toEqual({ action: 'gate-other', id: 'gat_1' })
    expect(m.allowed_mentions).toEqual({ parse: [] })
  })

  it('without options offers only Other answer', () => {
    expect(buttons(gateMessage(gate(), 'en')).map((c) => parseCustomId(c.custom_id)?.action)).toEqual(['gate-other'])
  })

  it('puts many options in select menus, within 5 rows', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Option ${i} ${'x'.repeat(200)}`)
    const rows = rowsOf(gateMessage(gate(many), 'en'))
    expect(rows.length).toBeLessThanOrEqual(5)
    const selects = rows.flatMap((r) => r.components).filter((c) => c.type === 3)
    expect(selects.flatMap((s) => s.options!.map((o) => o.value))).toEqual(many.map((_, i) => String(i)))
    for (const s of selects) expect(s.options!.length).toBeLessThanOrEqual(25)
    for (const c of rows.flatMap((r) => r.components)) expect(c.custom_id!.length).toBeLessThanOrEqual(100)
  })

  it('cuts long button labels to 80', () => {
    for (const c of buttons(gateMessage(gate(['y'.repeat(300)]), 'en'))) expect(c.label!.length).toBeLessThanOrEqual(80)
  })
})

describe('noticeText', () => {
  it("is the notice's own title and body, as Discord markdown", () => {
    expect(noticeText({ title: 'Plan done', body: 'All *good*' })).toBe('**Plan done**\nAll **good**')
  })
})
