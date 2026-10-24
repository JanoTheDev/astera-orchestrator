// Re-runs an orchestration command whose write the Host refused with OrchStateConflict (ruling F56).
//
// **The command is re-run, not the write.** The refused `state-put` carried a whole state built from
// stale data; replaying it would overwrite the commit the Host made in between, which is what F56
// forbids. By the time the conflict is thrown the mirror already holds the Host's state
// (mirrorStore.ts), so running the command again decides from the truth — and a command that is no
// longer valid there (its Job deleted, already started) answers with its own refusal.
//
// **Only while it has not acted.** Many commands act outside the state before their last write
// (start a planner, make a worktree, send to a session); running one of those again would act twice.
import type { handleCommand } from '../../core/orchestration/command'
import { isStateConflict, rerunOnConflict } from '../../core/orchestration/stateConflict'

type Handle = typeof handleCommand
type Deps = Parameters<Handle>[0]

// Deps that act outside OrchState. Reads, and `backup` (a second snapshot of the same state harms nothing), are not here.
const EFFECTS = [
  'startWorker', 'releaseWorker', 'unregisterRolling', 'mergeWorktrees', 'removeWorktrees', 'discardRunWorktree',
  'startCoordinator', 'stopCoordinator', 'makeRunWorktree', 'browserRun', 'startValidation', 'startReview',
  'startRepair', 'repairOnce', 'onDispatchLost', 'sendSession', 'chatSend', 'chatAnswer', 'dispatchTask',
  'startAccount', 'createSession', 'intakeInputs', 'writeIntakeText', 'deliverPush', 'cleanWorktrees',
  'saveTestCommand', 'addRunConfig', 'setProjectAccount',
  'handoffs.save', 'sessionTasks.start', 'sessionTasks.complete', 'sessionTasks.cancel',
  'github.run', 'github.createPr', 'github.push', 'completionChecks.run', 'worktreesOps.remove'
] as const

export const BUSY_ERROR = 'Astera was busy saving other work and could not finish this. Try again.'

type Fn = (...a: unknown[]) => unknown

/** `deps` with every effect marking `onAct` before it runs. Nested groups are proxied, not spread, so a
 *  group that is a class instance keeps its prototype's methods. */
function tracked(deps: Deps, onAct: () => void): Deps {
  const top: Record<string, unknown> = { ...deps }
  const nested = new Map<string, Set<string>>()
  for (const path of EFFECTS) {
    const [k, m] = path.split('.')
    if (m === undefined) {
      const f = top[k]
      if (typeof f === 'function') top[k] = (...a: unknown[]) => (onAct(), (f as Fn).apply(top, a))
    } else nested.set(k, (nested.get(k) ?? new Set()).add(m))
  }
  for (const [k, methods] of nested) {
    const group = top[k]
    if (typeof group !== 'object' || group === null) continue
    top[k] = new Proxy(group, {
      get(t, p) {
        const v = Reflect.get(t, p) as unknown
        if (typeof v !== 'function') return v
        return methods.has(String(p))
          ? (...a: unknown[]) => (onAct(), (v as Fn).apply(t, a))
          : (v as Fn).bind(t)
      }
    })
  }
  return top as unknown as Deps
}

export async function handleWithRetry(
  handle: Handle,
  deps: Deps,
  caller: Parameters<Handle>[1],
  cmd: string,
  args: Record<string, unknown>,
  o?: {
    log?: (line: string) => void
    sleep?: (ms: number) => Promise<void>
    /** Throw the last conflict instead of answering 409: for callers to whom a 409 means "no", not "not now". */
    throwConflict?: true
  }
): ReturnType<Handle> {
  let acted = false
  let attempts = 0
  try {
    return await rerunOnConflict(
      (attempt) => {
        attempts = attempt
        acted = false
        return handle(tracked(deps, () => (acted = true)), caller, cmd, args)
      },
      { sleep: o?.sleep, mayRerun: () => !acted }
    )
  } catch (err) {
    if (!isStateConflict(err)) throw err
    o?.log?.(
      `orch.command: ${cmd} was refused after ${attempts} attempt(s)${acted ? ', after it had acted outside the state' : ''} — ${err.message}`
    )
    if (o?.throwConflict) throw err
    return { status: 409, body: { error: BUSY_ERROR, conflict: 'state-moved-on' } }
  }
}
