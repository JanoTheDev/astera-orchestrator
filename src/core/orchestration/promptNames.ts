// W10-A Run as written by name: the prompt ids the owner types ("run W8-A, B, D then all of W9", "next waves") become
// the plan's prompt files, found in the project's prompts folder, so nothing has to be attached. Pure: the Host lists
// the files and reads PLAN.md (command.ts `resolvePromptNames`), this only reads text and names.
import path from 'node:path'
import { parseWaveTable, promptIdOf } from './promptWaves'
import type { OrchState } from './state'

/** A prompt file's name: `<id>-<anything>.md`, the id a capital letter, a number, a dash and a letter or number. */
export const PROMPT_FILE = /^[A-Z]\d+-[A-Z0-9]+-.+\.md$/

/** How deep in the repository a prompts folder is looked for: `docs/dev/prompts` is three levels. */
export const PROMPTS_DIR_MAX_DEPTH = 3

/** What the owner's text names. */
export interface PromptNames {
  /** The ids written out, lists and ranges expanded, in the order written, each once. */
  ids: string[]
  /** "all of W9": the wave prefixes. */
  allOf: string[]
  /** "next wave" (the first wave not done) or "next waves" (every wave not done). */
  next?: 'wave' | 'waves'
  /** What cannot be read: a range whose ends are in different waves. */
  problems: string[]
}

const WAVE = String.raw`[A-Z]\d+`
const NAMES = new RegExp(
  [
    // W9-{A,B,C}
    String.raw`\b(${WAVE})-\{([^}]*)\}`,
    // W8-A…D, W8-A..W8-D, W8-A to D
    String.raw`\b(${WAVE})-([A-Z])\s*(?:…|\.{2,3}|–|—|\bto\b)\s*(?:(${WAVE})-)?([A-Z])(?![\w-])`,
    // all of W9
    String.raw`\b[Aa]ll of (${WAVE})(?![\w-])`,
    // W8-A, B, D and F
    String.raw`\b(${WAVE})-([A-Z0-9]+)(?![\w])((?:(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)[A-Z0-9](?![\w-]))*)`
  ].join('|'),
  'g'
)

/** The prompt ids, waves and "next wave(s)" in `text`. */
export function promptNamesOf(text: string): PromptNames {
  const ids: string[] = []
  const allOf: string[] = []
  const problems: string[] = []
  const add = (id: string): void => {
    if (!ids.includes(id)) ids.push(id)
  }
  for (const m of text.matchAll(NAMES)) {
    if (m[1] !== undefined) {
      for (const item of m[2].split(',').map((x) => x.trim())) {
        if (/^[A-Z0-9]+$/.test(item)) add(`${m[1]}-${item}`)
        else problems.push(`${m[0]}: "${item}" is not a prompt letter`)
      }
    } else if (m[3] !== undefined) {
      const [wave, from, toWave, to] = [m[3], m[4], m[5], m[6]]
      if (toWave !== undefined && toWave !== wave) problems.push(`${m[0]}: the range starts in ${wave} and ends in ${toWave}`)
      else if (to < from) problems.push(`${m[0]}: the range runs backwards`)
      else for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) add(`${wave}-${String.fromCharCode(c)}`)
    } else if (m[7] !== undefined) {
      if (!allOf.includes(m[7])) allOf.push(m[7])
    } else {
      add(`${m[8]}-${m[9]}`)
      for (const more of m[10].match(/[A-Z0-9](?![\w-])/g) ?? []) add(`${m[8]}-${more}`)
    }
  }
  const next = /\bnext waves\b/i.test(text) ? 'waves' : /\bnext wave\b/i.test(text) ? 'wave' : undefined
  return { ids, allOf, ...(next ? { next } : {}), problems }
}

/** Whether `text` is a list of names to look up, not a pasted document: it names something, and no line is a
 *  heading (a pasted prompt starts `# W10-A …`, and a document of `##` sections stays W8-C's). */
export function isNamesText(text: string): boolean {
  if (/^\s*#/m.test(text)) return false
  const n = promptNamesOf(text)
  return n.ids.length > 0 || n.allOf.length > 0 || n.next !== undefined || n.problems.length > 0
}

/** The folder holding the most prompt files (`PROMPT_FILE`), from the repository's `.md` files (repository-relative,
 *  `/`-separated), at most PROMPTS_DIR_MAX_DEPTH levels deep; undefined when none holds one. A tie goes to the
 *  shallower folder, then the first in name order. */
export function detectPromptsDir(files: readonly string[]): string | undefined {
  const count = new Map<string, number>()
  for (const f of files) {
    const dir = path.posix.dirname(f)
    const depth = dir === '.' ? 0 : dir.split('/').length
    if (depth > PROMPTS_DIR_MAX_DEPTH || !PROMPT_FILE.test(path.posix.basename(f))) continue
    count.set(dir, (count.get(dir) ?? 0) + 1)
  }
  return [...count.entries()].sort(
    ([a, x], [b, y]) => y - x || a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0)
  )[0]?.[0]
}

/** `p` (absolute, or relative to `root`) as a repository-relative `/` path, or the sentence to refuse it with. */
export function repoRelative(root: string, p: string): { ok: true; rel: string } | { ok: false; error: string } {
  const abs = path.resolve(root, p)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, error: `${p}: outside the repository (${root})` }
  return { ok: true, rel: rel === '' ? '.' : rel.split(path.sep).join('/') }
}

/** What the names resolved to. */
export interface PromptResolution {
  /** Each picked prompt: its id and its file, repository-relative. */
  picked: { id: string; path: string }[]
  /** Ids left out, and why ("already in plan …", "wave 8 is marked done"). */
  skipped: { id: string; why: string }[]
  /** One line per way something was picked: "next waves: wave 1 (P1-A, P1-B), wave 2 (P2-A)". */
  why: string[]
  /** Why the plan cannot start, each naming its id. Any: nothing is created. */
  problems: string[]
}

/** The files `names` pick from the prompts folder `dir` (repository-relative) holding `files` (its `.md` names).
 *  `planMd` is PLAN.md's text (the wave table), `taken` the prompt files another plan of the project already runs or
 *  ran, by file name, with why. Written-out ids are taken as written (a done row is skipped later, by promptPlanOf);
 *  "all of" and "next wave(s)" leave out what is done or taken. */
export function resolvePromptNames(
  names: PromptNames,
  dir: string,
  files: readonly string[],
  planMd: string | undefined,
  taken: ReadonlyMap<string, string>
): PromptResolution {
  const picked: PromptResolution['picked'] = []
  const skipped: PromptResolution['skipped'] = []
  const why: string[] = []
  const problems = [...names.problems]
  const rel = (f: string): string => (dir === '.' ? f : `${dir}/${f}`)
  const fileOf = (id: string): string | undefined => {
    const hits = files.filter((f) => f.startsWith(`${id}-`) && f.endsWith('.md'))
    if (hits.length === 0) problems.push(`${id}: no file ${rel(`${id}-*.md`)}`)
    else if (hits.length > 1) problems.push(`${id}: two or more files match (${hits.map(rel).join(', ')})`)
    return hits.length === 1 ? hits[0] : undefined
  }
  const pick = (id: string, file: string): void => {
    if (!picked.some((p) => p.id === id)) picked.push({ id, path: rel(file) })
  }
  for (const id of names.ids) {
    const f = fileOf(id)
    if (f !== undefined) pick(id, f)
  }
  const rows = planMd === undefined ? [] : parseWaveTable(planMd)
  const doneIds = new Set(rows.filter((r) => r.done).flatMap((r) => r.ids))
  for (const wave of names.allOf) {
    const mine = files.filter((f) => PROMPT_FILE.test(f) && promptIdOf(f)?.startsWith(`${wave}-`)).sort()
    if (mine.length === 0) problems.push(`all of ${wave}: no file ${rel(`${wave}-*.md`)}`)
    const got: string[] = []
    for (const f of mine) {
      const id = promptIdOf(f)!
      if (doneIds.has(id)) skipped.push({ id, why: 'its wave is marked done in PLAN.md' })
      else if (taken.has(f)) skipped.push({ id, why: taken.get(f)! })
      else if (mine.filter((g) => promptIdOf(g) === id).length > 1) fileOf(id)
      else (pick(id, f), got.push(id))
    }
    if (got.length) why.push(`all of ${wave}: ${got.join(', ')}`)
  }
  if (names.next !== undefined) {
    const waves: string[] = []
    if (rows.length === 0) problems.push(`next ${names.next}: PLAN.md has no wave table (| Wave | Tabs | Prompts | Depends on |)`)
    for (const row of rows) {
      if (row.done) continue
      const got: string[] = []
      for (const id of row.ids) {
        const f = fileOf(id)
        if (f === undefined) continue
        if (taken.has(f)) skipped.push({ id, why: taken.get(f)! })
        else got.push(id)
      }
      if (got.length === 0) continue
      for (const id of got) pick(id, files.find((f) => f.startsWith(`${id}-`))!)
      waves.push(`wave ${row.label} (${got.join(', ')})`)
      if (names.next === 'wave') break
    }
    if (waves.length) why.push(`next ${names.next}: ${waves.join(', ')}; ${names.next === 'wave' ? 'the first wave' : 'every wave'} of PLAN.md not marked done or in a plan`)
    else if (rows.length) problems.push(`next ${names.next}: nothing left; every wave in PLAN.md is marked done or already in a plan`)
  }
  return { picked, skipped, why, problems }
}

/** The prompt files (by file name) that plans of the project (`mine`) already hold: a plan not archived or rejected
 *  takes its prompts; an archived one keeps the prompts whose Task completed in one of its runs. With why. */
export function takenPrompts(s: OrchState, mine: (job: OrchState['jobs'][number]) => boolean): Map<string, string> {
  const taken = new Map<string, string>()
  for (const j of s.jobs) {
    if (j.verbatim === undefined || j.rejected !== undefined || !mine(j)) continue
    const name = j.title ?? j.id
    const runs = new Set(s.runs.filter((r) => r.jobId === j.id).map((r) => r.id))
    for (const v of j.verbatim) {
      if (v.taskId === undefined || taken.has(v.source)) continue
      if (j.archivedAt === undefined) taken.set(v.source, `already in plan "${name}" (${j.id})`)
      else if (s.tasks.some((t) => t.runId !== undefined && runs.has(t.runId) && t.title === v.title && t.status === 'completed'))
        taken.set(v.source, `done in plan "${name}" (${j.id})`)
    }
  }
  return taken
}
