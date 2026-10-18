// W8-C prompts mode ("Run as written"): the owner's prompt files become a plan's Tasks unchanged, and their order comes
// from docs/orchestrator/PLAN.md's wave table and the prompts' own "run alone" / "after X merges" sentences. Pure: the
// Host reads the files (jobs-create), this only reads their text.
import { createHash } from 'node:crypto'

export const sha256Of = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** A prompt's id, from its file name or heading: `W9-A` of `W9-A-foundation.md`, `W0` of `W0-linux-baseline.md`. */
export function promptIdOf(name: string): string | undefined {
  return /^(W\d+(?:-[A-Z0-9]+)?)(?![A-Za-z0-9])/.exec(name.trim())?.[1]
}

/** One `## ` section of a document: its heading text and its text, from its `## ` line up to the next one. */
export interface DocSection {
  heading: string
  text: string
}

/** The `## ` sections of one document, and the text before the first (its preamble). Fewer than two: not split.
 *  shortcut: a `## ` line inside a code fence counts as a heading too; skip fenced lines if a prompt ever has one. */
export function splitSections(doc: string): { preamble: string; sections: DocSection[] } | null {
  const starts: number[] = []
  const re = /^## /gm
  for (let m = re.exec(doc); m !== null; m = re.exec(doc)) starts.push(m.index)
  if (starts.length < 2) return null
  const sections = starts.map((at, k) => {
    const text = doc.slice(at, starts[k + 1] ?? doc.length)
    return { heading: text.slice(3).split(/\r?\n/)[0].trim(), text }
  })
  return { preamble: doc.slice(0, starts[0]).trim(), sections }
}

/** One row of PLAN.md's wave table. */
export interface WaveRow {
  /** The Wave cell without "(done)": `9.1`. */
  label: string
  done: boolean
  /** The prompt ids its Prompts cell names (backticked file names). */
  ids: string[]
  /** "alone" in its Prompts or Depends-on cell. */
  alone: boolean
}

const cellsOf = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/** The rows of the table whose header starts `| Wave | Tabs | Prompts | Depends on |`, in order; [] without one. */
export function parseWaveTable(planMd: string): WaveRow[] {
  const lines = planMd.split(/\r?\n/)
  const head = lines.findIndex((l) => /^\|\s*Wave\s*\|\s*Tabs\s*\|\s*Prompts\s*\|\s*Depends on\s*\|/.test(l))
  if (head < 0) return []
  const rows: WaveRow[] = []
  for (const line of lines.slice(head + 2)) {
    if (!line.trim().startsWith('|')) break
    const [wave = '', , prompts = '', dependsOn = ''] = cellsOf(line)
    const ids = [...prompts.matchAll(/`([^`]+)`/g)].map((m) => promptIdOf(m[1])).filter((x): x is string => x !== undefined)
    rows.push({
      label: wave.replace(/\(done\)/i, '').trim(),
      done: /\(done\)/i.test(wave),
      ids,
      alone: /\balone\b/i.test(prompts) || /\balone\b/i.test(dependsOn)
    })
  }
  return rows
}

/** A prompt to order: `key` is its source (file name or `doc#<heading>`), `name` its file stem or heading. */
export interface PromptSource {
  key: string
  name: string
  text: string
}

export interface PromptOrder {
  /** Per kept source key, the keys it waits for. */
  deps: Record<string, string[]>
  /** Per kept source key, one line: where it sits and why. */
  why: Record<string, string>
  /** Per skipped source key, why it gets no Task. */
  skipped: Record<string, string>
}

const ID = String.raw`W\d+(?:-[A-Z0-9]+)?`
const ID_LIST = String.raw`${ID}(?:(?:\s*,\s*|\s+and\s+|\s*,\s*and\s+)${ID})*`

/** The prompt ids a prompt's own text says it waits for: "after X merges", "after X and Y merge", "X is merged". */
export function afterIdsOf(text: string): string[] {
  // A quoted code comment ("`shortcut: wire into stamp.ts after W8-A merge`") names a later edit, not an order
  const plain = text.replace(/shortcut:[^`\n]*/gi, '').replace(/[*`_]/g, '')
  const out = new Set<string>()
  for (const re of [new RegExp(`[Aa]fter (${ID_LIST}) merge`, 'g'), new RegExp(`(${ID_LIST}) (?:is|are) merged`, 'g')])
    for (const m of plain.matchAll(re)) for (const id of m[1].match(new RegExp(ID, 'g')) ?? []) out.add(id)
  return [...out]
}

export const runsAlone = (text: string): boolean => /\brun alone\b/i.test(text.replace(/[*`_]/g, ''))

/** The order of `sources` from PLAN.md (`planMd`, undefined when the project has none) and the prompts' sentences.
 *  Each table row is a wave after the rows before it; a prompt that says "run alone" is a wave of its own ahead of the
 *  rest of its row; a Task waits for every Task of the nearest earlier wave that has Tasks here. A done row's prompts
 *  are skipped. */
export function promptWaves(planMd: string | undefined, sources: readonly PromptSource[]): PromptOrder {
  const rows = planMd === undefined ? [] : parseWaveTable(planMd)
  const idOf = new Map(sources.map((s) => [s.key, promptIdOf(s.name)]))
  const textOf = new Map(sources.map((s) => [s.key, s.text]))
  const rowOf = (key: string): number => {
    const id = idOf.get(key)
    return id === undefined ? -1 : rows.findIndex((r) => r.ids.includes(id))
  }
  const skipped: Record<string, string> = {}
  for (const s of sources) {
    const r = rowOf(s.key)
    if (r >= 0 && rows[r].done) skipped[s.key] = `already done: wave ${rows[r].label} is marked done in PLAN.md`
  }
  const kept = sources.filter((s) => skipped[s.key] === undefined)
  // The waves, in order: per row, its "run alone" prompts one by one, then the rest together.
  // A row PLAN.md marks "alone" is a wave of one per prompt.
  const waves: { row: number; keys: string[] }[] = []
  rows.forEach((row, r) => {
    const mine = kept.filter((s) => rowOf(s.key) === r)
    for (const s of mine.filter((s) => row.alone || runsAlone(s.text))) waves.push({ row: r, keys: [s.key] })
    const rest = mine.filter((s) => !row.alone && !runsAlone(s.text))
    if (rest.length) waves.push({ row: r, keys: rest.map((s) => s.key) })
  })
  const deps: Record<string, string[]> = {}
  const why: Record<string, string> = {}
  waves.forEach((w, k) => {
    const prev = waves[k - 1]
    for (const key of w.keys) {
      deps[key] = prev ? [...prev.keys] : []
      const others = w.keys.filter((x) => x !== key).map((x) => idOf.get(x) ?? x)
      why[key] =
        `${idOf.get(key) ?? key}: wave ${rows[w.row].label}` +
        (others.length ? `, parallel with ${others.join(', ')}` : rows[w.row].alone || runsAlone(textOf.get(key)!) ? ', runs alone' : '') +
        (prev ? ` after wave ${rows[prev.row].label}` : '')
    }
  })
  for (const s of kept) if (why[s.key] === undefined) {
    deps[s.key] = []
    why[s.key] = `${idOf.get(s.key) ?? s.name}: not in PLAN.md's wave table`
  }
  // "after X merges": a dep on X's Task when X is in this plan, unless X already waits on this one (no cycle).
  const waitsOn = (from: string, target: string, seen = new Set<string>()): boolean =>
    from === target || (deps[from] ?? []).some((d) => !seen.has(d) && (seen.add(d), waitsOn(d, target, seen)))
  for (const s of kept) {
    const added: string[] = []
    for (const id of afterIdsOf(s.text)) {
      for (const other of kept) {
        if (other.key === s.key || idOf.get(other.key) !== id || deps[s.key].includes(other.key)) continue
        if (waitsOn(other.key, s.key)) continue
        deps[s.key].push(other.key)
        added.push(id)
      }
    }
    if (added.length) why[s.key] += `; after ${[...new Set(added)].join(', ')}`
  }
  return { deps, why, skipped }
}

/** One Task Astera writes for a Run-as-written plan, before it has an id. */
export interface PromptTask {
  /** The source key: the file name, or `doc#<heading>`. */
  key: string
  title: string
  /** The owner's text, byte for byte. */
  prompt: string
  /** Why it sits where it does, and a document's preamble as context. */
  spec: string
  /** Source keys it waits for. */
  deps: string[]
}

/** The Tasks of a Run-as-written plan and the sources it skips. `files` are the attached `.md` files (name and text);
 *  with none, `pasted` is the document. A single document with two or more `## ` headings is one Task per section. */
export function promptPlanOf(
  files: readonly { name: string; text: string }[],
  pasted: string,
  planMd: string | undefined
): { tasks: PromptTask[]; skipped: { key: string; sha256: string; why: string }[] } {
  const doc = files.length === 1 ? files[0].text : files.length === 0 ? pasted : undefined
  const split = doc === undefined ? null : splitSections(doc)
  const sources: (PromptSource & { title: string; context?: string })[] = split
    ? split.sections.map((x) => ({
        key: `doc#${x.heading}`,
        name: x.heading,
        title: x.heading,
        text: x.text,
        ...(split.preamble !== '' ? { context: split.preamble } : {})
      }))
    : files.length > 0
      ? files.map((f) => {
          const stem = f.name.replace(/\.md$/i, '')
          return { key: f.name, name: stem, title: stem, text: f.text }
        })
      : [{ key: 'doc', name: 'doc', title: pasted.trim().split(/\r?\n/)[0].replace(/^#+\s*/, '').slice(0, 80) || 'Prompt', text: pasted }]
  const order = promptWaves(planMd, sources)
  return {
    tasks: sources
      .filter((s) => order.skipped[s.key] === undefined)
      .map((s) => ({
        key: s.key,
        title: s.title,
        prompt: s.text,
        spec: s.context ? `${order.why[s.key]}\n\nContext (the document's text before its first section):\n${s.context}` : order.why[s.key],
        deps: order.deps[s.key]
      })),
    skipped: sources.filter((s) => order.skipped[s.key] !== undefined).map((s) => ({ key: s.key, sha256: sha256Of(s.text), why: order.skipped[s.key] }))
  }
}
