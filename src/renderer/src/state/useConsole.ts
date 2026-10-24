// T10: the Astera console's session for the bottom panel's Console tab (core/console/console.ts). The Host answers
// `console-ensure` each time the tab shows, starting the console when none is alive; an account roll is followed to
// the new session here, and a console that ended waits for the person to start it again.
import { useCallback, useEffect, useRef, useState } from 'react'

export type ConsoleState =
  | { status: 'starting' }
  | { status: 'ready'; sessionId: string; cwd: string | null }
  | { status: 'ended' }
  | { status: 'failed'; error: string }

export function useConsole(shown: boolean): { state: ConsoleState; start(): void } {
  const [state, setState] = useState<ConsoleState>({ status: 'starting' })
  const idRef = useRef<string | null>(null)

  const ensure = useCallback(async (): Promise<void> => {
    // A console already showing stays on screen while the Host is asked again
    setState((s) => (s.status === 'ready' ? s : { status: 'starting' }))
    try {
      // The home folder is the anchor main accepts with no project open
      const home = await window.api.system.homeDir()
      const r = await window.api.orch.command(home, 'console-ensure', {})
      const body = r.body as { id?: unknown; cwd?: unknown; error?: unknown } | null
      if (r.status === 200 && typeof body?.id === 'string') {
        idRef.current = body.id
        setState({ status: 'ready', sessionId: body.id, cwd: typeof body.cwd === 'string' ? body.cwd : null })
      } else setState({ status: 'failed', error: typeof body?.error === 'string' ? body.error : `status ${r.status}` })
    } catch (e) {
      setState({ status: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  useEffect(() => {
    if (shown) void ensure()
  }, [shown, ensure])

  useEffect(() => {
    const offRolled = window.api.on('session:rolled', ({ oldSessionId, info }) => {
      if (oldSessionId !== idRef.current) return
      idRef.current = info.id
      setState({ status: 'ready', sessionId: info.id, cwd: info.cwd ?? null })
    })
    const offExit = window.api.on('session:exit', ({ sessionId }) => {
      if (sessionId === idRef.current) setState({ status: 'ended' })
    })
    return () => {
      offRolled()
      offExit()
    }
  }, [])

  return { state, start: () => void ensure() }
}
