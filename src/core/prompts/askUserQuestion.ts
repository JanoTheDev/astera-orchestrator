// The question Claude Code's AskUserQuestion tool asks, as the model wrote it, and the answers a person
// composes for it on the conversation view's card.
//
// The input arrives through the PreToolUse hook (core/sessions/pendingPrompt.ts) — the transcript holds nothing
// while the CLI waits, so the hook is the only structured copy. This module never looks at the screen:
// labels, descriptions and the multi-select flag are quoted from the call, and the screen is read
// elsewhere (askScreen.ts) only to drive the dialog and to check its review.
//
// **Fail closed.** A shape that cannot be read in full parses to null, and the caller falls back to the
// banner that quotes the screen. Guessing at a half-read question would draw buttons the CLI never
// offered. The limits (1–4 questions, 2–4 options) are the tool's own schema.

export interface AskOption {
  label: string
  /** null when the model gave none — drawn as a label alone, never as an empty line. */
  description: string | null
}

export interface AskQuestion {
  /** The model's short label for the question (≤ 12 chars by the tool's schema); may be empty. */
  header: string
  question: string
  options: AskOption[]
  multiSelect: boolean
}

export interface AskForm {
  questions: AskQuestion[]
}

const QUESTIONS_MIN = 1
const QUESTIONS_MAX = 4
const OPTIONS_MIN = 2
const OPTIONS_MAX = 4

const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

export function parseAskUserQuestion(input: unknown): AskForm | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = (input as { questions?: unknown }).questions
  if (!Array.isArray(raw) || raw.length < QUESTIONS_MIN || raw.length > QUESTIONS_MAX) return null
  const questions: AskQuestion[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const q = item as Record<string, unknown>
    if (!nonBlank(q.question)) return null
    if (!Array.isArray(q.options) || q.options.length < OPTIONS_MIN || q.options.length > OPTIONS_MAX) return null
    const options: AskOption[] = []
    for (const o of q.options) {
      if (typeof o !== 'object' || o === null) return null
      const opt = o as Record<string, unknown>
      if (!nonBlank(opt.label)) return null
      options.push({ label: opt.label, description: nonBlank(opt.description) ? opt.description : null })
    }
    questions.push({
      header: typeof q.header === 'string' ? q.header : '',
      question: q.question,
      options,
      multiSelect: q.multiSelect === true
    })
  }
  return { questions }
}

/** One question's answer as composed on the card. `picks` are option indexes **in the order they were
 *  chosen** — the CLI's review lists a multiple choice in pick order (measured, spec §4), and the driver
 *  sends the digits in this order, so the two agree by construction. `other` is the free-text row, kept
 *  raw (not trimmed) so a space being typed is not eaten; trim it where it is used. */
export interface Answer {
  picks: number[]
  other: string
}

export function emptyAnswers(form: AskForm): Answer[] {
  return form.questions.map(() => ({ picks: [], other: '' }))
}

/**
 * A press on option `option` of question `q`.
 *
 * Single-select: the pick replaces whatever was there and clears the free text — the dialog's own
 * free-text row is one more option, exclusive with the rest. Multi-select: toggles, appending at the
 * end so pick order is preserved. Out of range: the same array back, untouched.
 */
export function togglePick(form: AskForm, answers: Answer[], q: number, option: number): Answer[] {
  const question = form.questions[q]
  if (!question || option < 0 || option >= question.options.length || !answers[q]) return answers
  return answers.map((a, i) => {
    if (i !== q) return a
    if (!question.multiSelect) return { picks: [option], other: '' }
    return a.picks.includes(option)
      ? { ...a, picks: a.picks.filter((p) => p !== option) }
      : { ...a, picks: [...a.picks, option] }
  })
}

/**
 * The free-text row of question `q` now reads `text`.
 *
 * Single-select: non-blank text is the answer, so the pick goes; blank text (the field being cleared)
 * leaves the pick alone. Multi-select: the text sits beside the picks, as the dialog's checkbox row does.
 */
export function setOther(form: AskForm, answers: Answer[], q: number, text: string): Answer[] {
  const question = form.questions[q]
  if (!question || !answers[q]) return answers
  const clean = cleanOther(text)
  return answers.map((a, i) => {
    if (i !== q) return a
    if (question.multiSelect) return { ...a, other: clean }
    return { picks: clean.trim() === '' ? a.picks : [], other: clean }
  })
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** One line the dialog can take: newlines and tabs become spaces (a newline would press Enter, a tab
 *  would move the dialog's focus), other control characters go. Not trimmed — see `Answer.other`. */
export function cleanOther(text: string): string {
  return text.replace(/\r\n|\r|\n|\t/g, ' ').replace(CONTROL_CHARS, '')
}

export function isAnswered(form: AskForm, answers: Answer[], q: number): boolean {
  const a = answers[q]
  if (!a || !form.questions[q]) return false
  return a.picks.length > 0 || a.other.trim() !== ''
}

export function allAnswered(form: AskForm, answers: Answer[]): boolean {
  return form.questions.every((_, i) => isAnswered(form, answers, i))
}

/** What the CLI's review will list for question `q`: the picked labels in pick order, then the free
 *  text — exactly the order the dialog itself uses (measured: `Methods, appendix`). */
export function expectedAnswers(form: AskForm, answers: Answer[], q: number): string[] {
  const question = form.questions[q]
  const a = answers[q]
  if (!question || !a) return []
  const labels = a.picks.map((i) => question.options[i]?.label ?? '').filter((l) => l !== '')
  const other = a.other.trim()
  return other === '' ? labels : [...labels, other]
}
