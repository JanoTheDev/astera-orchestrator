import { describe, expect, it } from 'vitest'
import { shortTitleOf } from './title'

describe('shortTitleOf', () => {
  it('keeps a short objective whole, without its closing dot', () => {
    expect(shortTitleOf('Add dark mode.')).toBe('Add dark mode')
  })
  it('takes the first sentence', () => {
    expect(shortTitleOf('Add dark mode to settings. Make it follow the system theme.')).toBe('Add dark mode to settings')
  })
  it('does not end a sentence inside a word', () => {
    expect(shortTitleOf('Create index.js exporting add(a, b). Cover both.')).toBe('Create index.js exporting add(a, b)')
  })
  it('takes the first line of multi-line text and skips blank lines and heading marks', () => {
    expect(shortTitleOf('\n\n## Fix the sidebar\nIt flickers when a plan starts')).toBe('Fix the sidebar')
  })
  it('cuts a long prompt at a word boundary within 60 characters', () => {
    const t = shortTitleOf('alright so we have had a lot of trouble with the way the planner names things and it needs to change soon')
    expect(t.length).toBeLessThanOrEqual(60)
    expect(t).toBe('alright so we have had a lot of trouble with the way the')
  })
  it('drops punctuation left at the cut', () => {
    expect(shortTitleOf(`${'a'.repeat(58)}, and more words here`)).toBe('a'.repeat(58))
  })
  it('hard-cuts one very long word', () => {
    expect(shortTitleOf('x'.repeat(100))).toBe('x'.repeat(60))
  })
  it('names a GitHub issue "#N Title"', () => {
    expect(shortTitleOf('Resolve GitHub issue #113 in JanoTheDev/Astera: Short title on Start\n\nbody')).toBe('#113 Short title on Start')
  })
  it('is empty for empty text', () => {
    expect(shortTitleOf('  \n ')).toBe('')
  })
})
