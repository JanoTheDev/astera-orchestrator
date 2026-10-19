// W10-A Run as written by name: the ids typed in the text, the folder they are found in, and what they resolve to.
import { describe, it, expect } from 'vitest'
import { detectPromptsDir, isNamesText, promptNamesOf, repoRelative, resolvePromptNames, takenPrompts } from './promptNames'
import { emptyState, type OrchState } from './state'

const PLAN_MD = [
  '| Wave | Tabs | Prompts | Depends on |',
  '|---|---|---|---|',
  '| 8 (done) | 1 | `W8-C-run-waves` | — |',
  '| 9 | 2 | `W9-A-foundation`, `W9-B-shell` | W8 merged |',
  '| 10 | 1 | `W10-A-run-by-name` | W9 merged |'
].join('\n')
const FILES = ['W8-C-run-waves.md', 'W9-A-foundation.md', 'W9-B-shell.md', 'W10-A-run-by-name.md', 'notes.md']
const none = new Map<string, string>()

describe('promptNamesOf', () => {
  it('a single id', () => expect(promptNamesOf('run W8-A please').ids).toEqual(['W8-A']))
  it('a list the way the owner writes it', () => {
    expect(promptNamesOf('run W8-A, B, D and F, then W9-B').ids).toEqual(['W8-A', 'W8-B', 'W8-D', 'W8-F', 'W9-B'])
    expect(promptNamesOf('run P1-A, B then P2-A').ids).toEqual(['P1-A', 'P1-B', 'P2-A'])
  })
  it('braces', () => expect(promptNamesOf('W9-{A, B,C}').ids).toEqual(['W9-A', 'W9-B', 'W9-C']))
  it('a range, with … or .. or "to"', () => {
    expect(promptNamesOf('W8-A…D').ids).toEqual(['W8-A', 'W8-B', 'W8-C', 'W8-D'])
    expect(promptNamesOf('W8-B..W8-C').ids).toEqual(['W8-B', 'W8-C'])
    expect(promptNamesOf('W8-A to C').ids).toEqual(['W8-A', 'W8-B', 'W8-C'])
  })
  it('a range whose ends are in different waves is a problem naming it', () => {
    const n = promptNamesOf('W8-A…W9-D')
    expect(n.ids).toEqual([])
    expect(n.problems).toEqual(['W8-A…W9-D: the range starts in W8 and ends in W9'])
  })
  it('"all of" and "next wave(s)"', () => {
    expect(promptNamesOf('all of W9, then W10-A')).toEqual({ ids: ['W10-A'], allOf: ['W9'], problems: [] })
    expect(promptNamesOf('run the next wave').next).toBe('wave')
    expect(promptNamesOf('Next waves').next).toBe('waves')
  })
  it('a file name counts as its id; each id once', () => expect(promptNamesOf('W9-A-foundation.md and W9-A').ids).toEqual(['W9-A']))
})

describe('isNamesText', () => {
  it('names with no heading line', () => {
    expect(isNamesText('run W8-A, B')).toBe(true)
    expect(isNamesText('next waves')).toBe(true)
    expect(isNamesText('fix the login bug')).toBe(false)
  })
  it('a pasted prompt or ## document stays W8-C’s', () => {
    expect(isNamesText('# W10-A\n\nAfter W9-A merges, do it.')).toBe(false)
    expect(isNamesText('## W9-A\ntext\n## W9-B\ntext')).toBe(false)
  })
})

describe('detectPromptsDir', () => {
  it('the folder with the most prompt files, at most 3 levels deep', () => {
    const files = ['README.md', 'docs/W1-A-x.md', 'docs/dev/prompts/W8-A-a.md', 'docs/dev/prompts/W8-B-b.md', 'a/b/c/d/W1-A-x.md', 'a/b/c/d/W1-B-x.md', 'a/b/c/d/W1-C-x.md']
    expect(detectPromptsDir(files)).toBe('docs/dev/prompts')
  })
  it('none when no folder holds one', () => expect(detectPromptsDir(['README.md', 'docs/guide.md'])).toBeUndefined())
  it('a tie goes to the shallower folder', () => expect(detectPromptsDir(['p/W1-A-x.md', 'q/r/W1-B-x.md'])).toBe('p'))
})

describe('repoRelative', () => {
  it('relative or absolute inside the repository', () => {
    expect(repoRelative('/r', 'docs/dev/prompts/')).toEqual({ ok: true, rel: 'docs/dev/prompts' })
    expect(repoRelative('/r', '/r/prompts')).toEqual({ ok: true, rel: 'prompts' })
  })
  it('outside it is refused', () => {
    expect(repoRelative('/r', '../other').ok).toBe(false)
    expect(repoRelative('/r', '/etc')).toEqual({ ok: false, error: '/etc: outside the repository (/r)' })
  })
})

describe('resolvePromptNames', () => {
  const resolve = (text: string, files = FILES, taken = none) => resolvePromptNames(promptNamesOf(text), 'docs/dev/prompts', files, PLAN_MD, taken)
  it('one file per id, repository-relative', () => {
    expect(resolve('W9-A, B').picked).toEqual([
      { id: 'W9-A', path: 'docs/dev/prompts/W9-A-foundation.md' },
      { id: 'W9-B', path: 'docs/dev/prompts/W9-B-shell.md' }
    ])
  })
  it('no file and two files are refused, each naming its id', () => {
    const r = resolve('W9-A, Z then W7-A', [...FILES, 'W9-A-again.md'])
    expect(r.picked).toEqual([])
    expect(r.problems).toEqual([
      'W9-A: two or more files match (docs/dev/prompts/W9-A-foundation.md, docs/dev/prompts/W9-A-again.md)',
      'W9-Z: no file docs/dev/prompts/W9-Z-*.md',
      'W7-A: no file docs/dev/prompts/W7-A-*.md'
    ])
  })
  it('"all of" leaves out a done wave and a prompt another plan holds', () => {
    const r = resolve('all of W9', FILES, new Map([['W9-B-shell.md', 'already in plan "x" (job1)']]))
    expect(r.picked.map((p) => p.id)).toEqual(['W9-A'])
    expect(r.skipped).toEqual([{ id: 'W9-B', why: 'already in plan "x" (job1)' }])
    const done = resolve('all of W8')
    expect(done.picked).toEqual([])
    expect(done.skipped).toEqual([{ id: 'W8-C', why: 'its wave is marked done in PLAN.md' }])
  })
  it('"next wave" is the first row not done; "next waves" every one, and says why', () => {
    expect(resolve('next wave').picked.map((p) => p.id)).toEqual(['W9-A', 'W9-B'])
    const all = resolve('next waves')
    expect(all.picked.map((p) => p.id)).toEqual(['W9-A', 'W9-B', 'W10-A'])
    expect(all.why).toEqual(['next waves: wave 9 (W9-A, W9-B), wave 10 (W10-A); every wave of PLAN.md not marked done or in a plan'])
  })
  it('"next wave" passes a wave another plan already holds', () => {
    const taken = new Map([
      ['W9-A-foundation.md', 'already in plan "x" (j)'],
      ['W9-B-shell.md', 'already in plan "x" (j)']
    ])
    expect(resolve('next wave', FILES, taken).picked.map((p) => p.id)).toEqual(['W10-A'])
  })
  it('nothing left is a problem', () => {
    const taken = new Map(FILES.map((f) => [f, 'already in plan "x" (j)']))
    expect(resolve('next waves', FILES, taken).problems).toEqual([
      'next waves: nothing left; every wave in PLAN.md is marked done or already in a plan'
    ])
  })
})

describe('takenPrompts', () => {
  const job = (id: string, extra: Partial<OrchState['jobs'][number]>): OrchState['jobs'][number] =>
    ({ id, objective: 'o', cwd: '/r', createdAt: 'now', verbatim: [{ title: 'W9-A-foundation', source: 'W9-A-foundation.md', sha256: 'x', taskId: 't1' }], ...extra }) as never
  it('a live plan holds its prompts; a rejected one or an archived one never run does not', () => {
    const s: OrchState = { ...emptyState(), jobs: [job('j1', { title: 'Wave 9' }), job('j2', { rejected: { at: 'now' } })] }
    expect([...takenPrompts(s, () => true)]).toEqual([['W9-A-foundation.md', 'already in plan "Wave 9" (j1)']])
    expect(takenPrompts({ ...s, jobs: [job('j3', { archivedAt: 'now' })] }, () => true).size).toBe(0)
  })
  it('an archived plan keeps a prompt whose Task completed', () => {
    const s = {
      ...emptyState(),
      jobs: [job('j3', { archivedAt: 'now' })],
      runs: [{ id: 'r1', jobId: 'j3' }],
      tasks: [{ id: 'x', runId: 'r1', title: 'W9-A-foundation', status: 'completed' }]
    } as unknown as OrchState
    expect(takenPrompts(s, () => true).get('W9-A-foundation.md')).toBe('done in plan "j3" (j3)')
  })
})
