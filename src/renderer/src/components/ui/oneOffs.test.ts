import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// One-off guard: every screen builds on components/ui. A raw control outside it fails here; the fix is the ui primitive.
const SRC = join(__dirname, '..', '..')

/** Files (posix path under src/renderer/src) or folders (trailing /) exempt from the scan, each with its reason. */
const ALLOW: Record<string, string> = {
  'components/assistant-ui/': 'vendored assistant-ui / shadcn code',
  'components/FileIcon.tsx': 'the file-type icon set is drawn SVG by design',
  'components/ProviderBadge.tsx': 'brand logo glyph, not an Icon-set icon',
  'components/ResumeGlyph.tsx': 'bespoke resume status glyph, not an Icon-set icon',
  'components/FlowDiagram.tsx': 'data-drawn diagram edges (how-it-works flow)',
  'components/plan/PlanGraph.tsx': 'data-drawn plan graph edges and legend line'
}

const RULES: [string, RegExp][] = [
  ['raw <button', /<button\b/],
  ['raw <select', /<select\b/],
  ['role="menu"/"listbox"', /role=["']?\{?["']?(menu|listbox)\b/],
  ['window.confirm', /\bwindow\.confirm\b/],
  ['inline <svg', /<svg\b/]
]

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return tsxFiles(p)
    return n.endsWith('.tsx') && !/\.test\.tsx$/.test(n) ? [p] : []
  })
}

/** Comments may mention the forbidden words; only code counts. */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

export function findOneOffs(files: Record<string, string>): string[] {
  const hits: string[] = []
  for (const [path, text] of Object.entries(files)) {
    const code = stripComments(text)
    for (const [name, re] of RULES) if (re.test(code)) hits.push(`${path}: ${name}`)
  }
  return hits
}

describe('one-off guard', () => {
  it('flags every banned one-off', () => {
    const bad = '<button/><select/><ul role="menu"/><ul role="listbox"/>window.confirm("x")<svg/>'
    expect(findOneOffs({ 'a.tsx': bad })).toHaveLength(5)
    expect(findOneOffs({ 'a.tsx': '// <button>\n/* <svg */ const x = 1' })).toEqual([])
  })

  it('finds no one-off outside components/ui', () => {
    const files: Record<string, string> = {}
    for (const p of tsxFiles(SRC)) {
      const rel = relative(SRC, p).split(sep).join('/')
      if (rel.startsWith('components/ui/')) continue
      if (Object.keys(ALLOW).some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a))) continue
      files[rel] = readFileSync(p, 'utf8')
    }
    expect(findOneOffs(files)).toEqual([])
  })

  it('allowlist entries still exist', () => {
    for (const a of Object.keys(ALLOW)) expect(() => statSync(join(SRC, a))).not.toThrow()
  })
})
