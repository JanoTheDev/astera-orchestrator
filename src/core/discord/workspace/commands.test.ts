import { describe, it, expect } from 'vitest'
import type { Project } from '../../orchestration/types'
import { parsePlanCommand, planCommands } from './commands'

const project = (i: number): Project => ({ id: `prj_${i}`, path: `/repo${i}`, name: `Repo ${i}`, addedAt: 'x' })

describe('planCommands', () => {
  it('is one /plan command with new, status and approve', () => {
    const [plan, ...rest] = planCommands([project(1)], 'en') as Array<{ name: string; options: Array<{ name: string; options?: Array<{ name: string; required?: boolean; choices?: unknown[] }> }> }>
    expect(rest).toEqual([])
    expect(plan.name).toBe('plan')
    expect(plan.options.map((o) => o.name)).toEqual(['new', 'status', 'approve'])
    const opts = plan.options[0].options!
    expect(opts.map((o) => [o.name, o.required])).toEqual([['objective', true], ['project', false]])
    expect(opts[1].choices).toEqual([{ name: 'Repo 1', value: 'prj_1' }])
  })

  it('offers project choices only while they fit Discord’s 25', () => {
    const plan = planCommands(Array.from({ length: 26 }, (_, i) => project(i)), 'en')[0] as { options: Array<{ options?: Array<{ choices?: unknown[] }> }> }
    expect(plan.options[0].options![1].choices).toBeUndefined()
  })
})

describe('parsePlanCommand', () => {
  const data = (sub: string, options?: unknown[]) => ({ name: 'plan', options: [{ type: 1, name: sub, ...(options ? { options } : {}) }] })

  it('reads each subcommand', () => {
    expect(parsePlanCommand(data('status'))).toEqual({ kind: 'status' })
    expect(parsePlanCommand(data('approve'))).toEqual({ kind: 'approve' })
    expect(parsePlanCommand(data('new', [{ name: 'objective', value: ' Do it ' }]))).toEqual({ kind: 'new', objective: 'Do it' })
    expect(parsePlanCommand(data('new', [{ name: 'objective', value: 'Do it' }, { name: 'project', value: 'prj_1' }]))).toEqual({ kind: 'new', objective: 'Do it', project: 'prj_1' })
  })

  it('ignores anything else', () => {
    expect(parsePlanCommand(null)).toBeNull()
    expect(parsePlanCommand({ name: 'other', options: [] })).toBeNull()
    expect(parsePlanCommand(data('delete'))).toBeNull()
    expect(parsePlanCommand(data('new', [{ name: 'objective', value: '  ' }]))).toBeNull()
    expect(parsePlanCommand(data('new', [{ name: 'objective', value: 5 }]))).toBeNull()
  })
})
