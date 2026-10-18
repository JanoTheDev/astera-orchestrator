// W6-G: each account's latest rate limits, from the statusLine payloads its sessions' capture script wrote
// (`<profile>/statusline/<sid>.json`, StatusLineManager). The windows are the account's, whichever of its sessions
// reported them, so the newest file wins. The usage guard (core/orchestration/usageGuard.ts) reads this in the Host
// and in the app.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AccountReading } from '../orchestration/usageGuard'
import { parseStatusLinePayload } from './statusline'

export async function readAccountReadings(
  statuslineDir: string,
  sessions: ReadonlyArray<{ id: string; accountId: string | null | undefined }>
): Promise<Map<string, AccountReading>> {
  const newest = new Map<string, { at: number; reading: AccountReading }>()
  await Promise.all(
    sessions.map(async (s) => {
      if (!s.accountId) return
      const file = path.join(statuslineDir, `${s.id}.json`)
      try {
        const [text, st] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
        const u = parseStatusLinePayload(JSON.parse(text))
        if (!u || (!u.session && !u.weekly)) return
        const had = newest.get(s.accountId)
        if (!had || st.mtimeMs > had.at) newest.set(s.accountId, { at: st.mtimeMs, reading: { session: u.session, weekly: u.weekly } })
      } catch {
        // no payload yet, or one being rewritten: this session tells nothing
      }
    })
  )
  return new Map([...newest].map(([id, v]) => [id, v.reading]))
}
