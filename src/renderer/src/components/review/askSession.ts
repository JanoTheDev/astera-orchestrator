// Ask AI on a worktree with no live worker: start a new chat session and type the prompt in once it is ready. A turn
// written before the session's handshake settles is refused (Codex) or misordered (Claude), and the `ready` event can
// come before `start` has answered the id, so readiness is listened for first and remembered.

export interface AskSessionDeps {
  /** Subscribes to sessions saying they are ready; answers the unsubscribe. */
  onReady: (cb: (sessionId: string) => void) => () => void
  /** Starts the session; its id, or null when it did not start (the starter already said why). */
  start: () => Promise<string | null>
  send: (sessionId: string, text: string) => Promise<void>
  /** What happened to the prompt: typed in, the session not ready within `timeoutMs`, or the send failed. */
  settled: (outcome: 'sent' | 'timeout' | Error) => void
  setTimer: (fn: () => void, ms: number) => void
  timeoutMs: number
}

/** Answers the new session's id; null when nothing started, and then `settled` is never called. */
export async function askInNewSession(text: string, d: AskSessionDeps): Promise<string | null> {
  const ready = new Set<string>()
  let id: string | null = null
  let state: 'waiting' | 'sending' | 'done' = 'waiting'
  const settle = (outcome: 'sent' | 'timeout' | Error): void => {
    if (state === 'done') return
    state = 'done'
    d.settled(outcome)
  }
  const deliver = (sid: string): void => {
    if (state !== 'waiting') return
    state = 'sending'
    off()
    d.send(sid, text).then(
      () => settle('sent'),
      (err: unknown) => settle(err instanceof Error ? err : new Error(String(err)))
    )
  }
  const off = d.onReady((sid) => {
    if (sid === id) deliver(sid)
    else ready.add(sid)
  })
  try {
    id = await d.start()
  } catch (err) {
    off()
    throw err
  }
  if (id === null) {
    off()
    return null
  }
  if (ready.has(id)) deliver(id)
  else
    d.setTimer(() => {
      if (state !== 'waiting') return
      off()
      settle('timeout')
    }, d.timeoutMs)
  return id
}
