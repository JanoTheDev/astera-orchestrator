import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  commitShaOf,
  finderMarkerOf,
  frontMatterOf,
  isRepo,
  isSafeSegment,
  rawUrl,
  skillReposOf,
  skillSourcesFromTree
} from './skillsCatalog'

// Recorded from api.github.com/repos/anthropics/skills/git/trees/<commit>?recursive=1 on 2026-10-24,
// trimmed to skills/pdf and template, plus made-up entries for an unsafe name, an unsafe file path,
// an oversized skill and a symlink.
const tree = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/github-tree.json'), 'utf8')) as unknown
const COMMIT = 'dbd4588f9e1033efb41dad4bef2f7947c8993d44'

describe('skillSourcesFromTree', () => {
  const sources = skillSourcesFromTree('anthropics/skills', COMMIT, tree)
  const names = sources.map((s) => s.name)

  it('finds each <dir>/SKILL.md with the files under that dir', () => {
    const pdf = sources.find((s) => s.name === 'pdf')
    expect(pdf).toMatchObject({ repo: 'anthropics/skills', commit: COMMIT, path: 'skills/pdf' })
    expect(pdf?.files.map((f) => f.path).sort()).toEqual(['LICENSE.txt', 'SKILL.md', 'forms.md', 'reference.md'])
    expect(names).toContain('template')
  })

  it('leaves out a skill whose name or a file path is not a safe path segment', () => {
    expect(names).not.toContain('bad:name')
    expect(names).not.toContain('sneaky')
  })

  it('leaves out a skill over the size cap, and never downloads a symlink', () => {
    expect(names).not.toContain('huge')
    expect(sources.find((s) => s.name === 'linked')?.files.map((f) => f.path)).toEqual(['SKILL.md'])
  })

  it('answers nothing for a body that is not a tree', () => {
    expect(skillSourcesFromTree('a/b', COMMIT, { message: 'Not Found' })).toEqual([])
  })
})

describe('isSafeSegment', () => {
  it('takes a plain name and refuses traversal, separators and absolute paths', () => {
    expect(isSafeSegment('pdf')).toBe(true)
    expect(isSafeSegment('my-skill_1.0')).toBe(true)
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', '/etc', 'C:', 'a\0b', '.astera-finder.json']) expect(isSafeSegment(bad)).toBe(false)
  })
})

describe('frontMatterOf', () => {
  it('reads name and description, quoted or not', () => {
    expect(frontMatterOf('---\nname: pdf\ndescription: "Read PDFs: all of them"\nlicense: x\n---\n# body')).toEqual({
      name: 'pdf',
      description: 'Read PDFs: all of them'
    })
    expect(frontMatterOf('# no front matter')).toEqual({})
  })
})

describe('repos', () => {
  it('accepts owner/repo only', () => {
    expect(isRepo('anthropics/skills')).toBe(true)
    for (const bad of ['anthropics', 'a/b/c', '../x', 'a/..', 'https://github.com/a/b']) expect(isRepo(bad)).toBe(false)
  })

  it('narrows the setting to valid repos, without duplicates', () => {
    expect(skillReposOf(['a/b', 'a/b', 'bad', 3, 'c/d'])).toEqual(['a/b', 'c/d'])
    expect(skillReposOf('a/b')).toEqual([])
  })
})

describe('commitShaOf / rawUrl / finderMarkerOf', () => {
  it('reads the commit sha and pins raw URLs to it', () => {
    expect(commitShaOf({ sha: COMMIT })).toBe(COMMIT)
    expect(commitShaOf({ sha: 'main' })).toBeNull()
    expect(rawUrl('anthropics/skills', COMMIT, 'skills/pdf/SKILL.md')).toBe(
      `https://raw.githubusercontent.com/anthropics/skills/${COMMIT}/skills/pdf/SKILL.md`
    )
  })

  it('reads the finder marker or null', () => {
    const m = { repo: 'a/b', path: 'skills/x', commit: COMMIT }
    expect(finderMarkerOf(JSON.stringify(m))).toEqual(m)
    expect(finderMarkerOf('{}')).toBeNull()
    expect(finderMarkerOf(null)).toBeNull()
  })
})
