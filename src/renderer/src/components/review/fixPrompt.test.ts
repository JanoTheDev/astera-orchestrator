import { describe, expect, it } from 'vitest'
import { changeRequestText, fixPrompt, MAX_QUOTED_CHARS, rangeText, type CodeRef } from './fixPrompt'

const ref: CodeRef = { path: 'src/a.ts', start: 10, end: 14, diff: '@@ -10,3 +10,5 @@\n a\n-b\n+c\n+d\n', symbol: 'run' }

describe('fixPrompt', () => {
  it('names the file, the line range and the symbol, then the note, then the quoted diff', () => {
    const p = fixPrompt(ref, '  use a map instead ')
    expect(p).toContain('src/a.ts, lines 10-14 (in `run`)')
    expect(p).toContain('What I want: use a map instead')
    expect(p).toContain('```diff\n@@ -10,3 +10,5 @@\n a\n-b\n+c\n+d\n```')
    expect(p.indexOf('What I want')).toBeLessThan(p.indexOf('```diff'))
  })

  it('asks for a review when the note is empty', () => {
    expect(fixPrompt({ ...ref, symbol: undefined }, ' ')).toContain('What I want: Review this change')
  })

  it('fences with more backticks than the code holds', () => {
    const p = fixPrompt({ ...ref, diff: '+const s = ```x```\n' }, 'x')
    expect(p).toContain('````diff\n+const s = ```x```\n````')
  })

  it('cuts a huge diff and says how much was left out', () => {
    const p = fixPrompt({ ...ref, diff: '+'.repeat(MAX_QUOTED_CHARS + 10) }, 'x')
    expect(p).toContain('(cut: 10 more characters)')
    expect(p.length).toBeLessThan(MAX_QUOTED_CHARS + 600)
  })
})

describe('changeRequestText', () => {
  it('names the Task by title and id, then the place, the note and the diff', () => {
    const s = changeRequestText({ id: 'tsk_1', title: 'Add login' }, { ...ref, start: 3, end: 3, symbol: undefined }, 'wrong check')
    expect(s.split('\n')[0]).toBe('Request changes on Task "Add login" (tsk_1): src/a.ts, line 3.')
    expect(s).toContain('\nwrong check\n')
    expect(s).toContain('```diff')
  })
})

describe('rangeText', () => {
  it('says one line or a range', () => {
    expect(rangeText({ start: 4, end: 4 })).toBe('line 4')
    expect(rangeText({ start: 4, end: 9 })).toBe('lines 4-9')
  })
})
