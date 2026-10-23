// The review view's reads: the change map of a folder, the viewed marks kept per folder, and the worker's report of
// the Task a worktree belongs to.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { ChangeMap, ChangeMapFile } from '../../../../core/review/changeMap'
import type { OrchDoor } from '../../lib/orchDoor'
import { parseViewed, viewedKey, viewedReducer, type ViewedState } from './reviewModel'

/** undefined while reading; null when the folder is not known to the app or git could not answer. */
export function useChangeMap(cwd: string, base?: string): { map: ChangeMap | null | undefined; refresh: () => void } {
  const [map, setMap] = useState<ChangeMap | null | undefined>(undefined)
  const [seq, setSeq] = useState(0)
  useEffect(() => {
    let live = true
    void window.api.review.changeMap({ cwd, ...(base ? { base } : {}) }).then(
      (m) => live && setMap(m),
      () => live && setMap(null)
    )
    return () => {
      live = false
    }
  }, [cwd, base, seq])
  return { map, refresh: useCallback(() => setSeq((n) => n + 1), []) }
}

const readStored = (key: string): ViewedState => {
  try {
    return parseViewed(window.localStorage.getItem(key))
  } catch {
    return {}
  }
}

/** The "viewed" marks of the files in `folder`, kept in localStorage (a storage that throws keeps them in memory). */
export function useViewed(folder: string): [ViewedState, (file: ChangeMapFile) => void] {
  const key = viewedKey(folder)
  const [state, dispatch] = useReducer(viewedReducer, key, readStored)
  useEffect(() => dispatch({ type: 'load', state: readStored(key) }), [key])
  const toggle = useCallback(
    (file: ChangeMapFile) => {
      const next = viewedReducer(readStored(key), { type: 'toggle', file })
      try {
        if (Object.keys(next).length === 0) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // private mode or a full quota: the mark lives until the view closes
      }
      dispatch({ type: 'toggle', file })
    },
    [key]
  )
  return [state, toggle]
}

/** The Task's `result` (the worker's "what I did"), through `tasks-get`; null while unknown or when there is none. */
export function useTaskReport(door: OrchDoor | null, taskId: string | undefined): string | null {
  const [report, setReport] = useState<string | null>(null)
  // a door is made per render by its callers: read through a ref, so a re-render does not fetch again
  const doorRef = useRef(door)
  doorRef.current = door
  const hasDoor = door !== null
  useEffect(() => {
    setReport(null)
    const d = doorRef.current
    if (!d || !taskId) return
    let live = true
    d.command('tasks-get', { id: taskId }).then(
      (r) => {
        const body = r.body as { result?: unknown } | null
        if (live && r.status < 400 && typeof body?.result === 'string' && body.result.trim()) setReport(body.result.trim())
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [hasDoor, taskId])
  return report
}
