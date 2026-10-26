// What a job source answers, checked and cut by the Host (SDK + Plugin spec §18, Phase 4 design J7). A provider is a
// plugin, trusted code; the ticket inside its answer was written by someone else, and a page, a title or a body of any
// size must not slow the Host or the window it lands in. An answer of the wrong shape is refused with what is wrong;
// text past a limit is cut, and `cut` says so.
import type { JobSourceContext, JobSourceItem, JobSourceItemDetail } from '../pluginContract'

export type SourceItem = JobSourceItem
export type SourceDetail = JobSourceItemDetail
export type SourceContext = JobSourceContext

export type Checked<T> = { ok: true; value: T; cut: boolean } | { ok: false; problem: string }

export const SOURCE_ITEMS_MAX = 100
export const SOURCE_ID_MAX = 200
export const SOURCE_TITLE_MAX = 300
export const SOURCE_STATUS_MAX = 100
export const SOURCE_SUMMARY_MAX = 1_000
export const SOURCE_CURSOR_MAX = 2_000
export const SOURCE_BODY_MAX = 20_000
export const SOURCE_FIELDS_MAX = 50
export const SOURCE_FIELD_NAME_MAX = 100
export const SOURCE_FIELD_VALUE_MAX = 1_000
export const SOURCE_EVIDENCE_MAX = 20
export const SOURCE_EVIDENCE_TOTAL_MAX = 100_000
export const SOURCE_LABEL_MAX = 200
export const SOURCE_OBJECTIVE_MAX = 20_000
export const SOURCE_URL_MAX = 2_048
/** A plugin's own sentence (what it threw, why it does not run), as far as a caller reads it. */
export const SOURCE_ERROR_MAX = 1_000

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Counts characters (code points) the way a person does: a page of a million characters is never spread into an
 *  array, since a cut needs at most twice the limit in code units. */
const fits = (s: string, max: number): boolean => s.length <= max || (s.length <= max * 2 && Array.from(s).length <= max)

/** Characters (code points) in `s`, which a caller has already cut to a limit. */
const chars = (s: string): number => Array.from(s).length

/** `s` within `max` characters, `…` included; cut by code points, so an emoji is never halved. No room is nothing. */
function cutTo(s: string, max: number, cut: { cut: boolean }): string {
  if (fits(s, max)) return s
  cut.cut = true
  if (max <= 0) return ''
  return `${Array.from(s.slice(0, max * 2)).slice(0, max - 1).join('')}…`
}

/** `s` within `max` characters, `…` included, for text that says nothing of having been cut. */
export const clip = (s: string, max: number): string => cutTo(s, max, { cut: false })

/** Whether `id` can be an item's id (J9): 1 to SOURCE_ID_MAX characters, none of them a control character, since an id
 *  goes into a Job's source and onto the screen as it is (4a final review M3). */
export const isItemId = (id: string): boolean => id !== '' && fits(id, SOURCE_ID_MAX) && !/\p{Cc}/u.test(id)

/** A web address a person can open: http or https, nothing else (no `javascript:`, no `file:`), as the parser read it
 *  (the tabs and line breaks it skips are gone), and within SOURCE_URL_MAX characters, since half an address opens
 *  somewhere else. */
export const webUrl = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  try {
    const u = new URL(v)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.href.length <= SOURCE_URL_MAX ? u.href : undefined
  } catch {
    return undefined
  }
}

/** Up to `max` pairs whose names and values are text, each cut to its limit. */
function pairs(v: unknown, max: number, cut: { cut: boolean }): Record<string, string> | undefined {
  if (!isObject(v)) return undefined
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== 'string') continue
    if (n === max) {
      cut.cut = true
      break
    }
    out[cutTo(k, SOURCE_FIELD_NAME_MAX, cut)] = cutTo(val, SOURCE_FIELD_VALUE_MAX, cut)
    n += 1
  }
  return out
}

/** One item's fields, or why it is not one. `where` names it in the sentence: `item 3`, or `it`. */
function itemOf(v: unknown, where: string, cut: { cut: boolean }): SourceItem | string {
  if (!isObject(v)) return `${where} is not an object`
  if (typeof v.id !== 'string' || v.id === '') return `${where} has no id`
  if (!fits(v.id, SOURCE_ID_MAX)) return `${where} has an id longer than ${SOURCE_ID_MAX} characters`
  if (!isItemId(v.id)) return `${where} has a control character in its id`
  if (typeof v.title !== 'string') return `${where} has no title`
  const url = webUrl(v.url)
  return {
    id: v.id,
    title: cutTo(v.title, SOURCE_TITLE_MAX, cut),
    ...(typeof v.status === 'string' ? { status: cutTo(v.status, SOURCE_STATUS_MAX, cut) } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(typeof v.summary === 'string' ? { summary: cutTo(v.summary, SOURCE_SUMMARY_MAX, cut) } : {})
  }
}

/** A page of `listItems`: at most SOURCE_ITEMS_MAX items, and the cursor to the next page. */
export function itemsPage(answer: unknown): Checked<{ items: SourceItem[]; nextCursor?: string }> {
  if (!isObject(answer) || !Array.isArray(answer.items)) return { ok: false, problem: 'not an object with items' }
  const cut = { cut: answer.items.length > SOURCE_ITEMS_MAX }
  const items: SourceItem[] = []
  for (const [i, v] of answer.items.slice(0, SOURCE_ITEMS_MAX).entries()) {
    const item = itemOf(v, `item ${i}`, cut)
    if (typeof item === 'string') return { ok: false, problem: item }
    items.push(item)
  }
  const next = answer.nextCursor
  if (next !== undefined && next !== null && typeof next !== 'string') return { ok: false, problem: 'its nextCursor is not text' }
  if (typeof next === 'string' && next.length > SOURCE_CURSOR_MAX)
    return { ok: false, problem: `its nextCursor is longer than ${SOURCE_CURSOR_MAX} characters` }
  return { ok: true, cut: cut.cut, value: { items, ...(typeof next === 'string' && next !== '' ? { nextCursor: next } : {}) } }
}

/** One item read whole (`getItem`): its fields, its body and up to SOURCE_FIELDS_MAX fields of text. */
export function itemDetail(answer: unknown): Checked<SourceDetail> {
  if (!isObject(answer)) return { ok: false, problem: 'not an object' }
  const cut = { cut: false }
  const item = itemOf(answer, 'it', cut)
  if (typeof item === 'string') return { ok: false, problem: item }
  const fields = pairs(answer.fields, SOURCE_FIELDS_MAX, cut)
  return {
    ok: true,
    value: {
      ...item,
      ...(typeof answer.body === 'string' ? { body: cutTo(answer.body, SOURCE_BODY_MAX, cut) } : {}),
      ...(fields !== undefined ? { fields } : {})
    },
    cut: cut.cut
  }
}

/** What `buildJobContext` answers: an objective and a label it needs, evidence within SOURCE_EVIDENCE_MAX entries and
 *  SOURCE_EVIDENCE_TOTAL_MAX characters in all, counted as each entry's limit counts them. */
export function jobContext(answer: unknown): Checked<SourceContext> {
  if (!isObject(answer)) return { ok: false, problem: 'not an object' }
  if (typeof answer.objective !== 'string' || answer.objective.trim() === '') return { ok: false, problem: 'it has no objective' }
  if (typeof answer.sourceLabel !== 'string' || answer.sourceLabel.trim() === '') return { ok: false, problem: 'it has no sourceLabel' }
  const cut = { cut: false }
  const evidence: Array<{ label: string; content: string }> = []
  if (Array.isArray(answer.evidence)) {
    let left = SOURCE_EVIDENCE_TOTAL_MAX
    for (const e of answer.evidence) {
      if (!isObject(e) || typeof e.label !== 'string' || typeof e.content !== 'string') continue
      if (evidence.length === SOURCE_EVIDENCE_MAX || left <= 0) {
        cut.cut = true
        break
      }
      const content = cutTo(e.content, Math.min(SOURCE_BODY_MAX, left), cut)
      left -= chars(content)
      evidence.push({ label: cutTo(e.label, SOURCE_LABEL_MAX, cut), content })
    }
  }
  const url = webUrl(answer.sourceUrl)
  const metadata = pairs(answer.metadata, SOURCE_FIELDS_MAX, cut)
  return {
    ok: true,
    value: {
      objective: cutTo(answer.objective, SOURCE_OBJECTIVE_MAX, cut),
      sourceLabel: cutTo(answer.sourceLabel, SOURCE_LABEL_MAX, cut),
      ...(url !== undefined ? { sourceUrl: url } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
      ...(metadata !== undefined ? { metadata } : {})
    },
    cut: cut.cut
  }
}
