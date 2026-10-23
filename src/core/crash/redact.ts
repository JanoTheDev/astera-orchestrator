// T27: everything a crash report carries goes through here before it is written, so a report on disk and the issue
// body a person may send hold no secret. Over-redacting is fine; the report is for finding the frame, not the data.
const R = '[redacted]'

const RULES: Array<[RegExp, string]> = [
  // Bearer/authorization values first, so the token rules below do not leave half a header
  [/\b(bearer)\s+\S+/gi, `$1 ${R}`],
  // key=value / key: value pairs whose key names a secret
  [/\b(token|access_token|refresh_token|api[_-]?key|secret|password|passwd|pwd|auth|session|cookie)(\s*[=:]\s*)[^\s&;,)]+/gi, `$1$2${R}`],
  // JWTs
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, R],
  // Anthropic / OpenAI keys and OAuth tokens
  [/\bsk-[\w-]{16,}/g, R],
  // GitHub tokens
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/g, R],
  // Slack tokens
  [/\bx(ox[abprs]|app)-[\w-]{10,}/g, R],
  // Emails
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'],
  // Query strings of URLs: a token rides there more often than anywhere else
  [/(\b[a-z][\w+.-]*:\/\/[^\s?#)]*)\?[^\s)]*/gi, `$1?${R}`],
  // Home directories, Linux / macOS / Windows
  [/\/home\/[^/\s)]+/g, '~'],
  [/\/Users\/[^/\s)]+/g, '~'],
  [/[A-Za-z]:\\Users\\[^\\)\n]+/g, '~'],
  // Anything left that looks like a key: a long run with no spaces or path separators
  [/[\w+=-]{40,}/g, R]
]

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text with tokens, keys, emails, home paths and query strings removed. `home` is the user's actual home
 *  directory, for one outside /home, /Users and C:\Users. */
export function redact(text: string, home?: string): string {
  let out = text
  if (home && home.length > 1) out = out.replace(new RegExp(escape(home), 'g'), '~')
  for (const [re, to] of RULES) out = out.replace(re, to)
  return out
}
