import { useEffect, useState } from 'react'

/** As often as the workspace tree is read again (useWorkspaceData.ts). */
const POLL_MS = 5000

/**
 * W5-D (#42): the sessions the Host says wait at a permission prompt or a question, by id. The Host reads each
 * session's hook events itself (core/hooks/sessionState.ts), so a wait that began while the app was closed is here
 * from the first read, with its reason. `anchor` is any path the app may name, the door argument of `orch.command`.
 */
export function useHostWaiting(anchor: string | null): Record<string, 'permission' | 'question'> {
  const [byId, setById] = useState<Record<string, 'permission' | 'question'>>({})
  useEffect(() => {
    if (!anchor) return
    let alive = true
    const read = async (): Promise<void> => {
      try {
        const r = await window.api.orch.command(anchor, 'sessions-list', { status: 'waiting' })
        if (!alive || r.status !== 200) return
        const next: Record<string, 'permission' | 'question'> = {}
        // A `sessions-list` row (command.ts HostSession); the renderer does not import command.ts
        for (const s of r.body as Array<{ id: string; prompt?: 'permission' | 'question' }>) if (s.prompt) next[s.id] = s.prompt
        setById((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next))
      } catch {
        /* a Host that cannot be asked leaves the last answer */
      }
    }
    void read()
    const timer = setInterval(() => void read(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [anchor])
  return byId
}
