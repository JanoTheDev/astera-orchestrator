// T1: guards on how Astera calls gh. `gh pr edit` runs a GraphQL query GitHub now refuses for repositories that touch
// classic projects (prUpdate.ts), and `gh pr view` without `--json` prints text meant for a person, which no caller can
// read reliably. Scans every non-test source file under src/ for either call; comments are skipped.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...sources(p))
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

/** The code of a file with its comment lines blanked (a comment may name `gh pr edit` to say why it is not used). */
const code = (text: string): string =>
  text
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/\s\/\/.*$/, '')))
    .join('\n')

/** Every gh call in `text` that edits a PR, or views one without `--json`: argv arrays, and command strings that
 *  start with `gh` and name the pull request (a message that only mentions the command is no call). */
export function badGhCalls(text: string): string[] {
  const out: string[] = []
  const src = code(text)
  const q = `['"\`]`
  for (const m of src.matchAll(new RegExp(`${q}pr${q}\\s*,\\s*${q}edit${q}|${q}gh\\s+pr\\s+edit\\s+(\\$\\{|https?:|\\d|-)`, 'g'))) out.push(m[0])
  for (const m of src.matchAll(new RegExp(`${q}pr${q}\\s*,\\s*${q}view${q}[^\\]]*\\]?`, 'g')))
    if (!m[0].includes('--json')) out.push(m[0])
  for (const m of src.matchAll(/['"`]gh\s+pr\s+view\s+(\$\{|https?:|\d|-)[^\n'"`]*/g)) if (!m[0].includes('--json')) out.push(m[0])
  return out
}

describe('gh calls (T1)', () => {
  it('the matcher finds an edit and a plain view, and passes a --json view and a comment', () => {
    expect(badGhCalls("run(['pr', 'edit', url, '--body', b])")).toHaveLength(1)
    expect(badGhCalls("run(['pr', 'view', url])")).toHaveLength(1)
    expect(badGhCalls('exec(`gh pr view ${url}`)')).toHaveLength(1)
    expect(badGhCalls("run(['pr', 'view', url, '--json', 'state'])")).toEqual([])
    expect(badGhCalls('// `gh pr edit` is refused for classic projects')).toEqual([])
  })

  it('no source file under src/ runs gh pr edit, or gh pr view without --json', () => {
    const found: string[] = []
    for (const f of sources(SRC)) for (const c of badGhCalls(readFileSync(f, 'utf8'))) found.push(`${path.relative(SRC, f)}: ${c}`)
    expect(found).toEqual([])
  })
})
