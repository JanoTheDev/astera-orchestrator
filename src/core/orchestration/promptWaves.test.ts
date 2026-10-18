// W8-C prompts mode: the order of a Run-as-written plan from a PLAN.md-style wave table and the prompts' sentences.
import { describe, expect, it } from 'vitest'
import { afterIdsOf, parseWaveTable, promptIdOf, promptPlanOf, promptWaves, sha256Of, splitSections } from './promptWaves'

const PLAN = [
  '# Plan',
  '',
  '| Wave | Tabs | Prompts | Depends on |',
  '|---|---|---|---|',
  '| 7 (done) | 2 | `W7-A-plan-feedback`, `W7-B-projects` | W6 merged |',
  '| 8.0 | 1 | `W8-C-run-waves-in-astera` | 7 done |',
  '| 8 | 3 | `W8-A-commit`, `W8-B-line`, `W8-D-side` | W8-C merged |',
  '| 9.0 (done) | 1 | `W9-0-design-spec` | W8 merged |',
  '| 9.1 | 1 | `W9-A-foundation` (alone: tokens) | 9.0 approved |',
  '| 9.2 | 2 | `W9-B-shell`, `W9-C-plan-tab` | 9.1 merged |',
  '',
  'Text after.'
].join('\n')

const src = (name: string, text = `# ${name}\n\nDo it.\n`) => ({ key: `${name}.md`, name, text })

describe('promptWaves', () => {
  it('reads ids and the wave table', () => {
    expect(promptIdOf('W9-A-foundation')).toBe('W9-A')
    expect(promptIdOf('W9-0-design-spec')).toBe('W9-0')
    expect(promptIdOf('W0-linux-baseline-and-security')).toBe('W0')
    expect(promptIdOf('notes')).toBeUndefined()
    const rows = parseWaveTable(PLAN)
    expect(rows.map((r) => [r.label, r.done, r.ids, r.alone])).toEqual([
      ['7', true, ['W7-A', 'W7-B'], false],
      ['8.0', false, ['W8-C'], false],
      ['8', false, ['W8-A', 'W8-B', 'W8-D'], false],
      ['9.0', true, ['W9-0'], false],
      ['9.1', false, ['W9-A'], true],
      ['9.2', false, ['W9-B', 'W9-C'], false]
    ])
  })

  it('orders waves: parallel rows, a row after the one before, "after X merges", a done wave skipped, an unknown prompt', () => {
    const o = promptWaves(PLAN, [
      src('W8-C-run-waves-in-astera', '**Run alone**, before W8-A and W8-B.'),
      src('W8-A-commit'),
      src('W8-B-line', 'Start after W8-A merges.'),
      src('W8-D-side'),
      src('W9-0-design-spec'),
      src('W9-A-foundation'),
      src('W9-B-shell', 'W9-A is merged.'),
      src('W9-C-plan-tab'),
      src('W7-A-plan-feedback'),
      src('notes', 'after W8-D merges')
    ])
    expect(o.skipped).toEqual({
      'W9-0-design-spec.md': 'already done: wave 9.0 is marked done in PLAN.md',
      'W7-A-plan-feedback.md': 'already done: wave 7 is marked done in PLAN.md'
    })
    expect(o.deps['W8-C-run-waves-in-astera.md']).toEqual([])
    expect(o.deps['W8-A-commit.md']).toEqual(['W8-C-run-waves-in-astera.md'])
    expect(o.deps['W8-B-line.md']).toEqual(['W8-C-run-waves-in-astera.md', 'W8-A-commit.md'])
    expect(o.deps['W8-D-side.md']).toEqual(['W8-C-run-waves-in-astera.md'])
    // 9.0 is done, so 9.1 waits for the nearest wave with Tasks here: 8
    expect(o.deps['W9-A-foundation.md']).toEqual(['W8-A-commit.md', 'W8-B-line.md', 'W8-D-side.md'])
    expect(o.deps['W9-B-shell.md']).toEqual(['W9-A-foundation.md'])
    expect(o.deps['notes.md']).toEqual(['W8-D-side.md'])
    expect(o.why['W8-C-run-waves-in-astera.md']).toBe('W8-C: wave 8.0, runs alone')
    expect(o.why['W8-A-commit.md']).toBe('W8-A: wave 8, parallel with W8-B, W8-D after wave 8.0')
    expect(o.why['W8-B-line.md']).toBe('W8-B: wave 8, parallel with W8-A, W8-D after wave 8.0; after W8-A')
    expect(o.why['W9-A-foundation.md']).toBe('W9-A: wave 9.1, runs alone after wave 8')
    expect(o.why['notes.md']).toBe("notes: not in PLAN.md's wave table; after W8-D")
  })

  it('a prompt that says "run alone" is a wave of its own ahead of the rest of its row', () => {
    const o = promptWaves(PLAN, [src('W8-A-commit'), src('W8-B-line', 'Run alone: it touches everything.'), src('W8-D-side')])
    expect(o.deps['W8-B-line.md']).toEqual([])
    expect(o.deps['W8-A-commit.md']).toEqual(['W8-B-line.md'])
    expect(o.deps['W8-D-side.md']).toEqual(['W8-B-line.md'])
  })

  it('no PLAN.md: no row deps, only the prompts\' own sentences; an "after" that would close a cycle is dropped', () => {
    const o = promptWaves(undefined, [src('W1-A-x', 'after W1-B merges'), src('W1-B-y', 'after W1-A merges')])
    expect(o.deps).toEqual({ 'W1-A-x.md': ['W1-B-y.md'], 'W1-B-y.md': [] })
    expect(afterIdsOf('Start **after W8-C and W8-E merge**.')).toEqual(['W8-C', 'W8-E'])
    // a quoted code comment is a later edit, not an order (W8-B's prompt)
    expect(afterIdsOf('Until W8-A merges, it is marked `shortcut: wire into stamp.ts after W8-A merge`.')).toEqual([])
  })
})

describe('promptPlanOf', () => {
  it('one Task per prompt file, its text byte for byte', () => {
    const a = '# W8-A\n\nDo **this**  exactly.\r\n\n## Done means\n- x\n'
    const p = promptPlanOf([{ name: 'W8-A-commit.md', text: a }, { name: 'W8-D-side.md', text: 'Side.' }], '', PLAN)
    expect(p.tasks.map((t) => [t.key, t.title, t.prompt])).toEqual([
      ['W8-A-commit.md', 'W8-A-commit', a],
      ['W8-D-side.md', 'W8-D-side', 'Side.']
    ])
    expect(sha256Of(p.tasks[0].prompt)).toBe(sha256Of(a))
  })

  it('one document with two or more ## headings: one Task per section, the heading its title, the preamble as context', () => {
    const doc = 'Shared rules.\n\n## First thing\nDo one.\n### detail\nmore\n\n## Second thing\nDo two.\n'
    expect(splitSections('# only\n## one\n')).toBeNull()
    const p = promptPlanOf([], doc, undefined)
    expect(p.tasks.map((t) => [t.key, t.title, t.prompt])).toEqual([
      ['doc#First thing', 'First thing', '## First thing\nDo one.\n### detail\nmore\n\n'],
      ['doc#Second thing', 'Second thing', '## Second thing\nDo two.\n']
    ])
    expect(p.tasks[0].spec).toContain('Shared rules.')
    // a single attached file splits the same way
    expect(promptPlanOf([{ name: 'all.md', text: doc }], '', undefined).tasks.map((t) => t.title)).toEqual(['First thing', 'Second thing'])
  })
})
