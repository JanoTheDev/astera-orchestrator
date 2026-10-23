import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { guideSection, guideSectionNumbers, helpGuideRequest, readGuide, resolveGuidePath } from './run'
import { parseArgs } from '../core/orchestration/cliArgs'
import { unknownFlagError, usageFor } from '../core/orchestration/cliUsage'
import { sessionUsage } from '../core/orchestration/cliAgentContext'

const SKILLS = path.resolve(__dirname, '../../resources/skills')
const GUIDE = readFileSync(path.join(SKILLS, 'orchestration-guide.md'), 'utf8')
const QUICKREF = readFileSync(path.join(SKILLS, 'orchestration-quickref.md'), 'utf8')

describe('guideSection', () => {
  const doc = '# T\n\n## 1. One\nbody 1\n\n## 2. Two\nbody 2\n### 2.1 sub\nmore\n\n## 3. Three\nlast\n'
  it('cuts from its heading to the next ## heading', () => {
    expect(guideSection(doc, 2)).toBe('## 2. Two\nbody 2\n### 2.1 sub\nmore\n')
    expect(guideSection(doc, 3)).toBe('## 3. Three\nlast\n')
  })
  it('is null for a number the guide lacks, and 1 does not match 11', () => {
    expect(guideSection(doc, 4)).toBeNull()
    expect(guideSection('## 11. Eleven\nx\n', 1)).toBeNull()
  })
  it('lists the numbers in order', () => expect(guideSectionNumbers(doc)).toEqual([1, 2, 3]))
})

describe('helpGuideRequest', () => {
  it('reads --brief, a section number, and --skills-dir', () => {
    expect(helpGuideRequest(['--brief'])).toEqual({ brief: true })
    expect(helpGuideRequest(['12'])).toEqual({ brief: false, section: 12 })
    expect(helpGuideRequest(['--skills-dir', '/x', '4'])).toEqual({ brief: false, skillsDir: '/x', section: 4 })
  })
  it('refuses anything else', () => {
    expect(helpGuideRequest(['abc'])).toHaveProperty('error')
    expect(helpGuideRequest(['--brief', '3'])).toHaveProperty('error')
    expect(helpGuideRequest(['1', '2'])).toHaveProperty('error')
  })
})

describe('astera help on the shipped files', () => {
  it('--brief prints the quick reference file', () => {
    const p = resolveGuidePath({ args: {}, env: { ASTERA_SKILLS: SKILLS }, guide: 'quickref' })
    expect(p.ok && readGuide(p.path)).toEqual({ ok: true, content: QUICKREF })
  })
  it('section 12 starts with its heading and stops before any other', () => {
    const s = guideSection(GUIDE, 12)!
    expect(s.startsWith('## 12. ')).toBe(true)
    expect(s.match(/^## /gm)).toHaveLength(1)
  })
  it('the guide has sections 1 to 12', () => {
    expect(guideSectionNumbers(GUIDE)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

describe('the quick reference', () => {
  it('fits 6 KB', () => expect(Buffer.byteLength(QUICKREF)).toBeLessThanOrEqual(6144))

  const commands = QUICKREF.split('\n')
    .filter((l) => l.startsWith('astera '))
    .map((l) => l.replace(/\s+#.*$/, '').split(/\s+/).slice(1))

  it('has commands', () => expect(commands.length).toBeGreaterThan(10))

  it.each(commands.map((c) => [c.join(' '), c] as const))('astera %s parses', (_text, argv) => {
    if (argv[0] === 'help') return // answered in run.ts before the parser; covered by helpGuideRequest
    expect(parseArgs(argv)).not.toHaveProperty('error')
    const u = usageFor([...argv.slice(0, argv.findIndex((t) => t.startsWith('-'))), '--help'], sessionUsage)
    expect(u).not.toBeNull()
    expect(u).not.toHaveProperty('error')
    const parsed = parseArgs(argv) as { cmd: string }
    expect(unknownFlagError(parsed.cmd, argv)).toBeNull()
  })

  it('lists exactly the guide sections, by number and title', () => {
    const listed = [...QUICKREF.matchAll(/^(\d+) (.+)$/gm)].map((m) => Number(m[1]))
    expect(listed).toEqual(guideSectionNumbers(GUIDE))
  })
})
