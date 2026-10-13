import { describe, it, expect } from 'vitest'
import { parseNpmSpec } from './npmSpec'

// Plugins 2e (spec §12, design P14): what `astera plugins install --npm` takes. Only a registry name and a version reach
// npm, so no spec can name another source or carry a character a shell reads.
describe('parseNpmSpec', () => {
  it('takes a registry name with an optional version, tag or simple range', () => {
    expect(parseNpmSpec('astera-hello')).toEqual({ ok: true, name: 'astera-hello', range: null })
    expect(parseNpmSpec('@acme/astera-jira')).toEqual({ ok: true, name: '@acme/astera-jira', range: null })
    expect(parseNpmSpec('@acme/astera-jira@1.2.0')).toEqual({ ok: true, name: '@acme/astera-jira', range: '1.2.0' })
    for (const range of ['latest', 'beta', '^1.2.0', '~1.2', '1.x', '1.0.0-beta.1', '1.0.0+build.5', '*'])
      expect(parseNpmSpec(`x@${range}`), range).toEqual({ ok: true, name: 'x', range })
  })

  it('refuses another source: a URL, git, a file, a path, an alias, a GitHub shorthand', () => {
    for (const spec of [
      'https://example.com/x.tgz',
      'git+https://github.com/a/b.git',
      'github:a/b',
      'a/b',
      'file:../x',
      '../x',
      './x',
      'C:\\x',
      '/x',
      'npm:x@1',
      'x@npm:y@1',
      'x@file:../y',
      'x@https://e.com/y.tgz'
    ])
      expect(parseNpmSpec(spec).ok, spec).toBe(false)
  })

  it('refuses what a shell would read, a blank, a name npm does not allow, and a dangling @', () => {
    for (const spec of ['x@>=1.0.0', 'x@1 || 2', 'x@1;calc', 'x@1&calc', 'x@%PATH%', 'x@"1"', 'x@1|y', ' x', 'x ', '', 'X', '-x', '@acme', '@acme/', 'x@', 'x@@1', 'con'])
      expect(parseNpmSpec(spec).ok, JSON.stringify(spec)).toBe(false)
    expect(parseNpmSpec(42).ok).toBe(false)
  })

  it('says what is wrong', () => {
    expect(parseNpmSpec('https://example.com/x.tgz')).toEqual({
      ok: false,
      problem: 'https://example.com/x.tgz is not an npm package: give a package name, with @version or @tag if you like'
    })
    expect(parseNpmSpec('x@>=1')).toEqual({ ok: false, problem: 'x@>=1 has a version npm would need a shell to read: give a version, a tag, or a ^ or ~ range' })
  })
})
