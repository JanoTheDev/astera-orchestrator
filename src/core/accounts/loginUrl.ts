// W7-F (#82): reads the sign-in link out of a CLI login's output (`claude auth login`, `codex login`).
//
// claude 2.1 prints `If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?…` and then
// `Paste code here if prompted > ` with no newline; codex prints its local callback (`http://localhost:1455`) before
// the `https://auth.openai.com/oauth/authorize?…` link. So: the first https URL on a complete line, and a paste prompt
// anywhere. The URL carries the OAuth state and PKCE challenge: it is held in memory for the dialog, never logged.

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g
const HTTPS = /https:\/\/[^\s"'<>]+/
const PASTE = /paste (?:the )?code/i

export interface LoginOutput {
  url: string | null
  /** The CLI asks for the code shown after sign-in to be pasted back. */
  asksCode: boolean
}

/** Feed it stdout and stderr chunks as they come; answers what has been read so far. A line is read for its URL only
 *  once its newline arrived, so a URL split across chunks is never cut short. */
export function loginOutputReader(): (chunk: string) => LoginOutput {
  let pending = ''
  const out: LoginOutput = { url: null, asksCode: false }
  return (chunk) => {
    pending += chunk.replace(ANSI, '')
    if (PASTE.test(pending)) out.asksCode = true
    const nl = pending.lastIndexOf('\n')
    if (nl >= 0) {
      if (out.url === null) out.url = HTTPS.exec(pending.slice(0, nl))?.[0] ?? null
      pending = pending.slice(nl + 1)
    }
    return { ...out }
  }
}

/** A pasted code as the CLI may take it: one line, trimmed, not empty, not absurdly long. */
export function loginCodeOf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const code = v.trim()
  return code !== '' && code.length <= 512 && !/[\r\n]/.test(code) ? code : null
}
