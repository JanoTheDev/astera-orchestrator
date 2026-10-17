import { useEffect, useState } from 'react'
import type { Attention } from '../../../../core/types'

/** Each session's attention verdict (core/sessions/attention.ts): read once, then followed on
 *  'conversation:attention', which fires on a change only. Main keeps it for every session, terminal or chat. */
export function useAttention(sessionIds: readonly string[]): Record<string, Attention> {
  const [byId, setById] = useState<Record<string, Attention>>({})
  const key = sessionIds.join('\n')
  useEffect(() => {
    let alive = true
    const ids = new Set(sessionIds)
    for (const id of ids)
      void window.api.conversation
        .attention(id)
        .then((v) => alive && setById((p) => (p[id] === v ? p : { ...p, [id]: v })))
        .catch(() => {})
    const off = window.api.on('conversation:attention', ({ sessionId, value }) => {
      if (ids.has(sessionId)) setById((p) => (p[sessionId] === value ? p : { ...p, [sessionId]: value }))
    })
    return () => {
      alive = false
      off()
    }
    // `key` stands for the id list: a new array with the same ids must not re-subscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return byId
}
