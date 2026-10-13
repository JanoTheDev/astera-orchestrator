// What `astera plugins install --npm` takes (plugins 2e, spec §12, design P14): a package on the npm registry, by its name
// and, if the person likes, a version, a dist-tag or a simple range. Nothing else reaches npm: no URL, git, file or alias
// source, and no character a shell reads, since on Windows npm is reached through cmd.exe.
import { npmNameProblem } from './manifest'

/** A version, a tag or a ^, ~ or x range: what npm reads as one, and what cmd.exe passes on untouched when quoted. */
const RANGE = /^[0-9A-Za-z.+^~*-]+$/

export function parseNpmSpec(raw: unknown): { ok: true; name: string; range: string | null } | { ok: false; problem: string } {
  const notNpm = (): { ok: false; problem: string } => ({
    ok: false,
    problem: `${String(raw)} is not an npm package: give a package name, with @version or @tag if you like`
  })
  if (typeof raw !== 'string' || raw === '' || raw.startsWith('-')) return notNpm()
  // A scoped name starts with @, so its version follows the second @.
  const at = raw.indexOf('@', raw.startsWith('@') ? 1 : 0)
  const name = at < 0 ? raw : raw.slice(0, at)
  const range = at < 0 ? null : raw.slice(at + 1)
  if (npmNameProblem(name) !== null) return notNpm()
  if (range === null) return { ok: true, name, range: null }
  if (range === '' || range.includes(':') || range.includes('/') || range.includes('@')) return notNpm()
  if (!RANGE.test(range))
    return { ok: false, problem: `${raw} has a version npm would need a shell to read: give a version, a tag, or a ^ or ~ range` }
  return { ok: true, name, range }
}
