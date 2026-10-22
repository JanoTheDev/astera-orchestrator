// Adopting an untracked worker (run job_0b682db7df32e7b4, 2026-10-20): a live worker session whose Dispatch record was
// lost. Its Task then read "ready, no worker" (or stayed `dispatched` with nothing open), the watchdog started a
// duplicate, and once the duplicate was stopped nothing linked the original back: it finished and committed, and its
// Task stayed `dispatched` for good. The one durable link from a session to its Task is the spec name
// (`<taskId>-<dispatchId>.md`, coordinator.ts specFileName), which its launch and roll prompts carry; this reads it
// and records the Dispatch again under that same id, so the worker's own `worker_done` lands. Pure.
import { adoptDispatch, type OrchState } from '../state'
import type { Dispatch } from '../types'
import type { Provider } from '../../providers/meta'
import { specFileName } from './coordinator'

/** A live session the Host holds, with the text that names its spec: the launch prompt, the roll prompt (`--task-id
 *  … --dispatch-id …`) or the spec path. The rest is the session's own, for the Dispatch recorded for it. */
export interface LiveWorker {
  id: string
  spec?: string
  cwd?: string
  accountId?: string
  provider?: Provider
}

/** The Task and Dispatch a session's text names: its spec file's name, or the ids its roll prompt reports with. */
export function specIdsOf(text: string | undefined): { taskId: string; dispatchId: string } | null {
  if (!text) return null
  const m = /\b(tsk_[0-9a-z]+)-(dsp_[0-9a-z]+)\.md\b/.exec(text) ?? /--task-id (tsk_[0-9a-z]+) --dispatch-id (dsp_[0-9a-z]+)\b/.exec(text)
  return m ? { taskId: m[1], dispatchId: m[2] } : null
}

/** Each live session running a Task's spec with no record of its own, recorded as that Task's Dispatch. Only a session
 *  no Dispatch names, whose spec's Dispatch id is not recorded, onto a Task `ready` or `dispatched` with none open
 *  (`adoptDispatch`): a worker that reported, was stopped or was rolled has its record, and is never adopted. One per
 *  Task: of two sessions on the same spec, the first adopted holds it. `specsDir` is where its spec file is. */
export function adoptLiveWorkers(
  s: OrchState,
  live: readonly LiveWorker[],
  specsDir: string,
  now: string
): { state: OrchState; adopted: Dispatch[] } {
  let state = s
  const adopted: Dispatch[] = []
  for (const w of live) {
    const ids = specIdsOf(w.spec)
    if (!ids || state.dispatches.some((d) => d.sessionId === w.id)) continue
    const task = state.tasks.find((t) => t.id === ids.taskId)
    if (!task) continue
    // The provider of the Task's last attempt when the session cannot say: the same account list starts both
    const prior = state.dispatches.filter((d) => d.taskId === task.id).at(-1)
    const r = adoptDispatch(
      state,
      {
        taskId: task.id,
        dispatchId: ids.dispatchId,
        sessionId: w.id,
        provider: w.provider ?? prior?.provider ?? task.provider ?? 'claude',
        accountId: w.accountId ?? prior?.accountId ?? task.accountIds?.[0] ?? '',
        cwd: w.cwd ?? prior?.cwd ?? '',
        specPath: `${specsDir.replace(/\\/g, '/')}/${specFileName(task.id, ids.dispatchId)}`
      },
      now
    )
    if (!r.ok) continue
    state = r.state
    adopted.push(r.value)
  }
  return { state, adopted }
}
