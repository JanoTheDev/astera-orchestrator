// T9: the "Skills for this Task" section of a worker's spec file. What a worker is told to use depends on the Task's kind,
// and a skill is named only when the worker's account has it installed; otherwise the same rule is written in plain words.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { TaskKind } from '../types'

/** A rule that names a skill when `has(skill)` and otherwise says the same in plain words. */
const skillRule = (skill: string, named: string, plain: string, has: (s: string) => boolean): string =>
  has(skill) ? `- ${named} (\`${skill}\`).` : `- ${plain}`

/** The section for a Task of `kind`; every kind ends with the verification rule. `has` answers whether a skill is installed. */
export function skillsSection(kind: TaskKind, has: (skill: string) => boolean): string {
  const debugging = skillRule(
    'superpowers:systematic-debugging',
    'Find the root cause before you change anything',
    'Find the root cause before you change anything: reproduce the bug, trace it, test one hypothesis at a time.',
    has
  )
  const tdd = (what: string): string =>
    skillRule('superpowers:test-driven-development', `${what}: write the failing test first`, `${what}: write the failing test first, then the code that makes it pass.`, has)
  const rules: Record<TaskKind, string[]> = {
    bugfix: [debugging, tdd('Then fix it')],
    feature: [tdd('Build it')],
    refactor: ['- Keep behaviour exactly as it is. Run the tests of the files you touch before you start and again after every step.'],
    ui: [
      '- Follow `docs/dev/DESIGN-W11.md` and `components/ui/README.md`: house primitives only, tokens not colour literals.',
      '- Check the result with a screenshot (`npm run shots` only when no other heavy job is running).'
    ],
    audit: ['- Read-only first. Write each finding with `file:line` before you fix anything.'],
    docs: ['- Keep it short and true to the code: check every command and path you cite.'],
    test: ['- Test behaviour, not implementation. Each new test must fail without the code it covers.'],
    ops: ['- Change one thing at a time, say how to undo it, and never touch a profile or repository Astera is running on.']
  }
  const verify = skillRule(
    'superpowers:verification-before-completion',
    'Before you report, run the checks and read their output',
    'Before you report, run the checks and read their output: no success claim without it.',
    has
  )
  return `
---
## Skills for this Task (assembled by the app — do not delete)

This is a ${kind} Task.
${[...rules[kind], verify].join('\n')}
`
}

/** The skills installed under one account's config dir: `<name>` for `skills/<name>/SKILL.md` (where `skills install`
 *  puts its stubs) and `<plugin>:<name>` for the skills of an installed plugin (`plugins/cache/<market>/<plugin>/<version>/skills`). */
export async function installedSkillsIn(configDir: string): Promise<Set<string>> {
  const found = new Set<string>()
  const names = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    const out: string[] = []
    for (const e of entries)
      if (await fs.stat(path.join(dir, e.name, 'SKILL.md')).then((s) => s.isFile(), () => false)) out.push(e.name)
    return out
  }
  for (const n of await names(path.join(configDir, 'skills'))) found.add(n)
  const cache = path.join(configDir, 'plugins', 'cache')
  const dirs = async (dir: string): Promise<string[]> =>
    (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name))
  for (const market of await dirs(cache))
    for (const plugin of await dirs(market))
      for (const version of await dirs(plugin))
        for (const n of await names(path.join(version, 'skills'))) found.add(`${path.basename(plugin)}:${n}`)
  return found
}
