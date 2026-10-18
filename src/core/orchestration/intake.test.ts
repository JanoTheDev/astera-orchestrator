import { describe, expect, it } from 'vitest'
import { intakeChanges, intakeObjective, intakeOf, intakeTitle, needsInputs, type Intake } from './intake'

const read = (args: Record<string, unknown>): Intake => {
  const r = intakeOf(args)
  if (!r.ok) throw new Error(r.error)
  return r.intake
}

describe('intakeOf', () => {
  it('defaults to plan with nothing attached, which changes nothing', () => {
    const i = read({ objective: 'x' })
    expect(i).toEqual({ mode: 'plan', attach: [] })
    expect(intakeChanges(i)).toBe(false)
    expect(needsInputs(i)).toBe(false)
  })
  it('reads one --attach as a list, a repeated one as given, and an audit scope defaulting to all', () => {
    expect(read({ attach: '/a.pdf' }).attach).toEqual(['/a.pdf'])
    expect(read({ attach: ['/a.pdf', '/b.md'] }).attach).toEqual(['/a.pdf', '/b.md'])
    expect(read({ mode: 'audit' }).scope).toBe('all')
    expect(read({ mode: 'audit', scope: ' src/core ' }).scope).toBe('src/core')
  })
  it('refuses an unknown mode, a scope without audit, a multi-line scope and an empty attachment', () => {
    for (const args of [{ mode: 'yolo' }, { scope: 'src' }, { mode: 'audit', scope: 'a\nb' }, { attach: '' }, { attach: [1] }, { instructions: 3 }])
      expect(intakeOf(args).ok, JSON.stringify(args)).toBe(false)
  })
})

describe('intakeObjective', () => {
  const inputs = { dir: '/p/plans/job_1/inputs', names: ['spec.pdf', 'notes.md'] }
  it('lists every attached file to read first, PDFs over 20 pages in ranges, before the source', () => {
    const o = intakeObjective(read({ attach: ['/x/spec.pdf', '/y/notes.md'] }), 'Build the thing', inputs)
    expect(o).toContain('Read every file in /p/plans/job_1/inputs/ first (PDFs over 20 pages in page ranges)')
    expect(o).toContain('- /p/plans/job_1/inputs/spec.pdf\n- /p/plans/job_1/inputs/notes.md')
    expect(o.indexOf('Read every file')).toBeLessThan(o.indexOf('Build the thing'))
  })
  it('an audit audits its scope, writes inputs/audit.md, then plans the fixes', () => {
    const o = intakeObjective(read({ mode: 'audit', scope: 'src/core' }), '', { dir: inputs.dir, names: [] })
    expect(o).toMatch(/^Audit `src\/core` in the repository for bugs, security holes and missing tests/)
    expect(o).toContain('/p/plans/job_1/inputs/audit.md first')
    expect(o).toContain('plan Tasks that fix them')
    expect(intakeObjective(read({ mode: 'audit' }), '', { dir: inputs.dir, names: [] })).toMatch(/^Audit the whole repository/)
  })
  it('a fixlist plans one or more Tasks per problem, each naming the problems it closes', () => {
    const o = intakeObjective(read({ mode: 'fixlist' }), '1. login fails\n2. slow search')
    expect(o).toContain('Plan one or more Tasks per problem, and name in each Task which problem(s) it closes')
    expect(o).toContain('Source:\n1. login fails\n2. slow search')
  })
  it("puts the owner's instructions last, saying they win over the source", () => {
    const o = intakeObjective(read({ instructions: ' no new deps ' }), 'Do X')
    expect(o).toBe("Do X\n\nOwner's instructions (they win over the source when the two conflict):\nno new deps")
  })
})

// W7-D (#68): a plan made from a source is named by it, never by the objective's boilerplate
describe('intakeTitle', () => {
  it("a fixlist is named by its first problem's words, its list marker dropped", () => {
    expect(intakeTitle(read({ mode: 'fixlist' }), '\n1. login fails on Safari\n2. slow search', [])).toBe('login fails on Safari')
    expect(intakeTitle(read({ mode: 'fixlist' }), '- price rounds wrong', [])).toBe('price rounds wrong')
  })
  it('a long first problem is cut at a word, under 80 characters', () => {
    const t = intakeTitle(read({ mode: 'fixlist' }), `${'word '.repeat(40)}end`, [])!
    expect(t.length).toBeLessThanOrEqual(80)
    expect(t.endsWith('word…')).toBe(true)
  })
  it('an audit is "Audit <scope>"; files are named by their names', () => {
    expect(intakeTitle(read({ mode: 'audit', scope: 'src/core' }), '', [])).toBe('Audit src/core')
    expect(intakeTitle(read({ mode: 'audit' }), '', [])).toBe('Audit the whole repository')
    expect(intakeTitle(read({ attach: ['/d/spec.pdf', '/d/notes.md'] }), '', ['spec.pdf', 'notes.md'])).toBe('spec.pdf, notes.md')
    expect(intakeTitle(read({ mode: 'fixlist', attach: ['/d/bugs.pdf'] }), '', ['bugs.pdf'])).toBe('bugs.pdf')
  })
  it('a plain description needs no name: its objective is its own words', () => {
    expect(intakeTitle(read({ instructions: 'x' }), 'Add dark mode', [])).toBeUndefined()
  })
})

describe('intakeObjective in prompts mode', () => {
  it('names the Tasks and holds no planner fill-in text', () => {
    const o = intakeObjective(read({ mode: 'prompts', attach: ['a.md'] }), '', undefined, { tasks: ['tsk_1 (A)'], skipped: [] })
    expect(o).toMatch(/^Run as written/)
    expect(o).toContain('- tsk_1 (A)')
    expect(o).not.toContain('Fill in each one')
    expect(o).not.toContain('--affected-paths')
  })
})
