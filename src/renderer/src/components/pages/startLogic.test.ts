import { describe, it, expect } from 'vitest'
import { consolesIn, defaultMode, dropOpensStart, filesFromDrop, intakeTab, primaryLabel, promptCount, shouldLandOnStart } from './startLogic'

const t = (key: string, params?: Record<string, string | number>): string => (params ? `${key}:${JSON.stringify(params)}` : key)

describe('Start mode default', () => {
  it('prompt files attached → Run as written', () => {
    expect(defaultMode({ files: ['/p/a.md', '/p/b.md'], text: '' })).toBe('prompts')
  })
  it('text only → Plan it for me', () => {
    expect(defaultMode({ files: [], text: 'add dark mode' })).toBe('plan')
  })
  it('a PDF or an image alone is material for the planner', () => {
    expect(defaultMode({ files: ['/p/spec.pdf', '/p/shot.png'], text: '' })).toBe('plan')
  })
  it("the owner's pick wins", () => {
    expect(defaultMode({ files: ['/p/a.md'], text: '', chosen: 'plan' })).toBe('plan')
    expect(defaultMode({ files: [], text: 'x', chosen: 'prompts' })).toBe('prompts')
  })
})

describe('intakeTab', () => {
  it('maps the composer onto one W6-A intake tab', () => {
    expect(intakeTab({ mode: 'prompts', files: [], audit: true, issues: ['1'] })).toBe('prompts')
    expect(intakeTab({ mode: 'plan', files: ['/a.md'], audit: true, issues: ['1'] })).toBe('audit')
    expect(intakeTab({ mode: 'plan', files: ['/a.md'], audit: false, issues: ['1'] })).toBe('github')
    expect(intakeTab({ mode: 'plan', files: ['/a.pdf'], audit: false, issues: [] })).toBe('files')
    expect(intakeTab({ mode: 'plan', files: [], audit: false, issues: [] })).toBe('describe')
  })
})

describe('primaryLabel', () => {
  it('says what happens', () => {
    expect(primaryLabel({ mode: 'plan', files: [], text: 'x' }, t)).toEqual({ label: 'start.go.plan' })
    expect(primaryLabel({ mode: 'prompts', files: ['/a.md', '/b.md', '/c.md'], text: '' }, t)).toEqual({
      label: 'start.go.consoles:{"n":3}',
      note: 'start.go.filesNote:{"n":3}'
    })
    expect(primaryLabel({ mode: 'prompts', files: [], text: '## one\nx\n## two\n' }, t).note).toBe('start.go.sectionsNote:{"n":2}')
    expect(primaryLabel({ mode: 'plan', files: [], text: 'x', after: 'Auth' }, t)).toEqual({ label: 'start.go.queue:{"plan":"Auth"}' })
  })
  it('counts prompts', () => {
    expect(promptCount(['/a.md', '/b.pdf'], '')).toBe(1)
    expect(promptCount([], 'one document, no sections')).toBe(1)
    expect(promptCount([], '  ')).toBe(0)
  })
})

describe('empty-project landing', () => {
  it('no plans and no consoles → Start', () => {
    expect(shouldLandOnStart({ plans: 0, consoles: 0 })).toBe(true)
    expect(shouldLandOnStart({ plans: 1, consoles: 0 })).toBe(false)
    expect(shouldLandOnStart({ plans: 0, consoles: 1 })).toBe(false)
  })
  it('counts the consoles in the project folder, not a sibling', () => {
    const s = [{ cwd: '/w/app' }, { cwd: '/w/app/pkg' }, { cwd: '/w/app-two' }, { cwd: 'C:\\W\\App\\x' }]
    expect(consolesIn(s, '/w/app/')).toBe(2)
    expect(consolesIn(s, 'c:/w/app', true)).toBe(1)
  })
})

describe('drop to attach', () => {
  const pathFor = (f: { name: string }): string => (f.name === 'nopath.md' ? '' : `/d/${f.name}`)
  it('takes the files Start can attach', () => {
    const list = [{ name: 'a.md' }, { name: 'b.PDF' }, { name: 'c.zip' }, { name: 'shot.png' }, { name: 'nopath.md' }]
    expect(filesFromDrop(list, pathFor as never)).toEqual(['/d/a.md', '/d/b.PDF', '/d/shot.png'])
    expect(filesFromDrop(null, pathFor as never)).toEqual([])
  })
  it('opens Start only for a drop nothing else took', () => {
    expect(dropOpensStart({ defaultPrevented: false, files: ['/d/a.md'] })).toBe(true)
    expect(dropOpensStart({ defaultPrevented: true, files: ['/d/a.md'] })).toBe(false)
    expect(dropOpensStart({ defaultPrevented: false, files: [] })).toBe(false)
  })
})
