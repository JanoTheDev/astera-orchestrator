// W3-B: the phrasings simple enough to read without a model (SPEC §8's examples). Anything else goes to the
// coordinator model (prompt.ts). A miss here costs one cheap call; a wrong hit runs the wrong command, so each
// pattern is anchored to the whole sentence and only takes the shapes listed.
import type { Intent } from './types'

/** "the Console plan", "this plan", "Gameful Trading" → the name, or undefined for "this"/"the approved"/nothing. */
function targetOf(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const t = raw
    .trim()
    .replace(/[.?!]+$/, '')
    .replace(/^(the|this|that|my)\s+/i, '')
    .replace(/\s+(plan|project|workspace|terminals|sessions|workers)$/i, '')
    .replace(/^(approved|current|open)$/i, '')
    .replace(/^(plan|project|workspace|it)$/i, '')
    .trim()
  return t === '' ? undefined : t
}

const withTarget = <T extends Intent>(i: T, raw: string | undefined): T => {
  const target = targetOf(raw)
  return target === undefined ? i : { ...i, target }
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 }

export function fastParse(input: string): Intent | null {
  const s = input.trim().replace(/\s+/g, ' ')
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(?:switch|go|change) to (.+)$/i))) return withTarget({ kind: 'switch' }, m[1])
  if ((m = s.match(/^show (?:me )?(?:every|all) sessions? (?:needing|that need|waiting for) (?:my )?(?:input|me)(?: in (.+))?$/i)))
    return withTarget({ kind: 'waiting' }, m[1])
  if ((m = s.match(/^what are (?:the )?(?:(.+) )?workers waiting (?:for|on)\??$/i))) return withTarget({ kind: 'waiting' }, m[1])
  if ((m = s.match(/^show (?:the )?(.+?) (?:terminals|sessions)$/i))) return withTarget({ kind: 'show-sessions' }, m[1])
  if ((m = s.match(/^show (?:the )?(?:terminals|sessions)(?: (?:of|for|in) (.+))?$/i))) return withTarget({ kind: 'show-sessions' }, m[1])
  if ((m = s.match(/^show (?:the )?progress (?:on|of|for) (.+)$/i))) return withTarget({ kind: 'summarize' }, m[1])
  if ((m = s.match(/^summari[sz]e (?:the )?(?:last|past) (\d+|[a-z]+) (min|mins|minutes|hour|hours)\.?$/i))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()]
    if (n === undefined) return null
    return { kind: 'summarize', minutes: /^h/i.test(m[2]) ? n * 60 : n }
  }
  if ((m = s.match(/^summari[sz]e (.+)$/i))) return withTarget({ kind: 'summarize' }, m[1].replace(/^active /i, ''))
  if ((m = s.match(/^stop launching(?: new)?(?: tasks)?(?: (?:for|in|on) (.+))?$/i))) return withTarget({ kind: 'stop-launching' }, m[1])
  if ((m = s.match(/^pause (.+)$/i))) return withTarget({ kind: 'pause' }, m[1])
  if ((m = s.match(/^resume (.+)$/i))) return withTarget({ kind: 'resume' }, m[1])
  // "Approve the plan", "Start executing the approved plan", "approve Console". Not "start the next eligible X
  // tasks" (left to the model: run-start starts a plan, it does not pick tasks).
  if ((m = s.match(/^(?:approve|start executing|execute)(?: (.+))?$/i))) return withTarget({ kind: 'approve' }, m[1])
  if ((m = s.match(/^plan (.+)$/i))) return { kind: 'plan', objective: m[1].replace(/[.!]+$/, '') }
  // `send "text" to X` / `send text to X`: the last " to " splits, so the text may hold "to" itself.
  if ((m = s.match(/^send ["“](.+)["”] to (.+)$/i)) || (m = s.match(/^send (.+) to (.+?)$/i))) {
    const session = targetOf(m[2])
    // "send this to …" points at something on screen, which the text alone does not carry
    if (session === undefined || /^(this|that|it)$/i.test(m[1])) return null
    return { kind: 'send', text: m[1], session }
  }
  return null
}
