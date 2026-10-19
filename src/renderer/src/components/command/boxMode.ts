// W9-D: the one box (command bar + session search). What the person typed is either a search for something Astera
// holds, or a sentence for the coordinator; this picks which one Enter does.
import { fastParse } from '../../../../core/intents/fastPath'

export type BoxMode = 'search' | 'command'

/** A sentence is five words or more, or one that ends like one. */
const isSentence = (s: string): boolean => /[?.!]$/.test(s) || s.split(/\s+/).length >= 5

/**
 * `text` is a command when the fast path knows it ("pause trading") or it reads as a sentence; otherwise it is a
 * search while it finds anything (`hits`); two words that find nothing are a short command for the coordinator, and
 * one word that finds nothing stays a search (it says "no match" and runs nothing). Empty text is a search.
 */
export function boxModeOf(text: string, hits: number): BoxMode {
  const s = text.trim()
  if (s === '') return 'search'
  if (fastParse(s) !== null || isSentence(s)) return 'command'
  if (hits > 0) return 'search'
  return s.split(/\s+/).length >= 2 ? 'command' : 'search'
}
