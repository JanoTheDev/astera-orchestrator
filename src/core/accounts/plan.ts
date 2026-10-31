import type { AccountPlan, AccountPlanId } from '../types'

// Reads which subscription plan a Claude account is on (Pro / Max / Team / Ultra ...) out of the two
// files its config folder already holds. Pure and node-free: the caller supplies the file text, so the
// renderer could import this too. Read-only, and it only ever looks at the plan fields.
//
// Where the plan lives (Claude Code writes both):
//   .credentials.json  claudeAiOauth.subscriptionType ("max", "team", ...) and claudeAiOauth.rateLimitTier
//                      ("default_claude_max_20x", "default_claude_ultra", ...) — beside the token, which
//                      this module never returns or copies: only those two named fields are touched.
//   .claude.json       oauthAccount.organizationType ("claude_max", ...) and a few sibling plan fields,
//                      used when the credentials file has nothing (macOS keeps them in the Keychain).
//
// A string is matched case-insensitively on whole words, so "claude_max_20x", "Claude Team" and
// "claudeMaxPlan" all read as their plan. The first source holding a recognisable string decides;
// when none does the result is `unknown` and `raw` keeps the first string seen so the UI can show it as-is.

/** Priority within one string, so a string naming two words (it should not) resolves the same way every time. */
const WORDS: readonly [string, AccountPlanId][] = [
  ['ultra', 'ultra'],
  ['max', 'max'],
  ['enterprise', 'enterprise'],
  ['team', 'team'],
  ['pro', 'pro'],
  ['free', 'free']
]

function planIdOf(raw: string): AccountPlanId {
  const words = new Set(
    raw
      .replace(/([a-z])([A-Z])/g, '$1 $2') // claudeMaxPlan -> claude Max Plan
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  )
  for (const [word, id] of WORDS) if (words.has(word)) return id
  return 'unknown'
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    return asObject(JSON.parse(text))
  } catch {
    return null // corrupt reads like absent: this must never crash
  }
}

/** The plan strings in priority order. Only the named plan fields are read; the token fields next to
 *  them are never touched. */
function candidates(credentialsJson: string | null | undefined, claudeJson: string | null | undefined): string[] {
  const out: string[] = []
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim() !== '') out.push(v.trim())
  }
  const oauth = asObject(parseObject(credentialsJson)?.claudeAiOauth)
  if (oauth) {
    push(oauth.subscriptionType)
    push(oauth.rateLimitTier)
  }
  const account = asObject(parseObject(claudeJson)?.oauthAccount)
  if (account) {
    push(account.subscriptionType)
    push(account.organizationType)
    push(account.rateLimitTier)
    push(account.planType)
  }
  return out
}

/** The plan out of the text of `.credentials.json` and `.claude.json` (either may be absent or corrupt).
 *  `hasSessionWindow` is false only for Ultra, which has no 5-hour window; an unknown plan keeps it true. */
export function parseAccountPlan(
  credentialsJson: string | null | undefined,
  claudeJson: string | null | undefined
): AccountPlan {
  const strings = candidates(credentialsJson, claudeJson)
  for (const raw of strings) {
    const id = planIdOf(raw)
    if (id !== 'unknown') return { id, raw, hasSessionWindow: id !== 'ultra' }
  }
  return { id: 'unknown', raw: strings[0] ?? null, hasSessionWindow: true }
}

/** The two files `readAccountPlan` asks its reader for, by name inside the config folder. */
export type PlanFileName = '.credentials.json' | '.claude.json'

/** Reads the plan through an injected file reader (`null` for a missing file). A throwing reader reads as absent. */
export async function readAccountPlan(read: (name: PlanFileName) => Promise<string | null>): Promise<AccountPlan> {
  const safe = async (name: PlanFileName): Promise<string | null> => {
    try {
      return await read(name)
    } catch {
      return null
    }
  }
  const [credentials, claudeJson] = await Promise.all([safe('.credentials.json'), safe('.claude.json')])
  return parseAccountPlan(credentials, claudeJson)
}
