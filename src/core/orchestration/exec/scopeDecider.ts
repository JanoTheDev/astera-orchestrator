// T11: in a hands-off plan a worker's scope question ("may I touch files outside my paths?") is Astera's to settle from
// the plan's design, not the owner's. Pure: autoAnswer.ts `handsOffStepsDue` asks it before its refusal, so the
// permission words of such a question ("may I", "allowed", "permission to edit") no longer hold it for the owner.

/** What a scope question is judged against. */
export interface ScopeContext {
  /** The folders the plan works in: the Job's repository, the Run's worktree, the worker's own worktree. A path the
   *  question names must lie inside one of them. Empty: only relative paths are known to be inside. */
  roots: readonly string[]
  /** The Task's affected paths (relative to the repository), files or folders, a trailing glob allowed. */
  affectedPaths?: readonly string[]
  /** The owner-only categories besides a plain permission ask (deleting data, the default branch, force-push, money,
   *  credentials): text that matches is never a scope question. */
  guarded(text: string): boolean
}

/** The answer to a scope question: the instruction the worker follows. */
export const SCOPE_ANSWER =
  "Yes: hands-off plans settle scope from the plan's design. Keep the change to what your Task needs, list the extra " +
  'files in your report (`--files-modified`), and do not reformat code you do not need to change. Other Tasks may edit ' +
  'the same files; the merge settles overlaps.'

/** The decision's reason, in the activity feed. */
export const SCOPE_WHY = "a scope question: hands-off plans settle scope from the plan's design (the objective, the Task's spec and paths)"

// Changing something: touching, editing, creating, adding, a small refactor, an update
const ACTION =
  /\b(touch\w*|edit\w*|modif\w*|chang\w*|creat\w*|add|adds|added|adding|updat\w*|refactor\w*|extend\w*|adjust\w*|tweak\w*|fix|fixes|fixing|patch\w*|writ(e|es|ing)|wrote|mov(e|es|ing)|renam\w*|extract\w*|amend\w*|work (on|in)|working (on|in))\b/i
// What is changed: files, folders, tests, helpers, catalog entries
const TARGET =
  /\b(files?|folders?|director(y|ies)|tests?|specs?|helpers?|modules?|catalogs?|entr(y|ies)|keys?|strings?|code|components?|utils?|utilit(y|ies)|types?|functions?|configs?|fixtures?|snapshots?|imports?)\b/i
// Outside the Task's own paths, said in words
const OUTSIDE =
  /\b(outside|beyond|not (in|within|among|part of|covered by|listed in|under)|other than|besides|apart from|in addition to)\b[^.?!\n]{0,40}\b(paths?|scope|affected|allowed|assigned|listed|area)\b/i
const SCOPE_WORDS = /\b(affected[- _]?paths?|out of (my |the |its )?scope|scope|shared|other tasks?'?s?|another task'?s?|catalogs?|i18n)\b/i
// Raising privileges on the machine: never a scope question, whatever path it names
const SYSTEM = /\b(sudo|chmod|chown|icacls|takeown|root access|run as admin\w*|administrator|admin rights|elevat\w*|registry)\b/i

/** A path written with a drive letter, a leading slash, a home or environment variable, or a UNC prefix. */
const ABSOLUTE = /^([a-z]:\/|\/|~|\$|%)/i

/** `C:\Users\Me\` → `c:/users/me`: forward slashes, no doubled or trailing slash, lower case (Windows and macOS file
 *  systems ignore case, and a false "inside" is judged by the owner-only words anyway). */
function norm(p: string): string {
  const unc = /^[\\/]{2}/.test(p)
  const s = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase()
  return unc ? `/${s}` : s
}

/** The relative path `p` stays within its base: no `..` climbs above it. */
function staysInside(p: string): boolean {
  let depth = 0
  for (const seg of p.split('/')) {
    if (seg === '..') depth--
    else if (seg !== '.' && seg !== '') depth++
    if (depth < 0) return false
  }
  return true
}

/** The paths a question names: tokens with a slash or backslash, or a file name with an extension. */
export function pathsIn(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[\s"'`«»()[\]{},;]+/)) {
    const t = raw.replace(/[?!:.]+$/, '')
    if (t === '' || /^https?:/i.test(t) || /^(e\.g|i\.e|etc|vs)$/i.test(t)) continue
    if (/[\\/]/.test(t) || /^[\w.@-]+\.[a-z][a-z0-9]{0,5}$/i.test(t)) {
      // "and/or", "yes/no": words, not paths
      if (/^[a-z]+\/[a-z]+$/i.test(t) && !/\.[a-z]/i.test(t) && t.length < 12) continue
      out.push(t)
    }
  }
  return out
}

/** The path relative to the repository, or null when it lies outside every root. */
function relativeOf(p: string, roots: readonly string[]): string | null {
  const n = norm(p)
  if (!ABSOLUTE.test(n) && !/^\/\//.test(n)) return staysInside(n) ? n.replace(/^(\.\/)+/, '') : null
  for (const r of roots.map(norm).filter((x) => x !== '')) {
    if (n === r) return ''
    if (n.startsWith(`${r}/`)) {
      const rest = n.slice(r.length + 1)
      return staysInside(rest) ? rest : null
    }
  }
  return null
}

/** Whether `rel` is one of the Task's affected paths, or lies under one. */
function covered(rel: string, affected: readonly string[]): boolean {
  return affected.some((a) => {
    const base = norm(a.replace(/\*.*$/, '')).replace(/^(\.\/)+/, '')
    if (base === '') return true
    return rel === base || rel.startsWith(`${base}/`)
  })
}

/** Whether `text` is a worker's question about changing files outside its Task's paths, inside the plan's folders, and
 *  touching none of the owner-only categories. */
export function isScopeQuestion(text: string, ctx: ScopeContext): boolean {
  const paths = pathsIn(text)
  // The owner-only words are judged on the prose: a file name (`login.ts`, `src/payment/charge.ts`) is no credential
  // or money. A path without an extension stays, so `origin/main` is still the default branch.
  const files = new Set(paths.filter((p) => /\.[a-z][a-z0-9]{0,5}$/i.test(p)))
  const prose = text
    .split(/(\s+)/)
    .map((w) => (files.has(w.replace(/^["'`«(]+|["'`»),;:?!.]+$/g, '')) ? '' : w))
    .join('')
  if (ctx.guarded(prose) || SYSTEM.test(text)) return false
  const rel = paths.map((p) => relativeOf(p, ctx.roots))
  // A path outside the repository and the worktrees is never the plan's to settle
  if (rel.some((r) => r === null)) return false
  if (!ACTION.test(text) || !(TARGET.test(text) || paths.length > 0)) return false
  const elsewhere = rel.some((r) => r !== null && !covered(r, ctx.affectedPaths ?? []))
  return OUTSIDE.test(text) || SCOPE_WORDS.test(text) || elsewhere
}

/** The answer Astera gives a scope question, or null when it is not one. An option that says yes is picked first, so
 *  a question with options is answered with one of them. */
export function scopeAnswerOf(q: { question: string; options?: readonly string[] }, ctx: ScopeContext): string | null {
  if (!isScopeQuestion(q.question, ctx)) return null
  const yes = q.options?.find((o) => /^(yes|go|go ahead|proceed|allow\w*|approve\w*|ok|okay|continue)\b/i.test(o.trim()))
  return yes ? `${yes}: ${SCOPE_ANSWER.replace(/^Yes: /, '')}` : SCOPE_ANSWER
}
