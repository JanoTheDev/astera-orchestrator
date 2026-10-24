import type { OrchServerDeps } from './command'
import type { OrchState } from './state'

/** A write the Host refused because the state had moved on under it (ruling F56). Named so the
 *  callers that can say something useful about it can tell it from a disk failure — this one means
 *  "your action did not happen and the screen you decided from was stale", which is a sentence for a
 *  person, not for a log. */
export class OrchStateConflict extends Error {
  constructor(
    readonly hostVersion: number | undefined,
    readonly sentVersion: number | undefined
  ) {
    super(
      `the orchestration state moved on before this write landed (Host at ${String(hostVersion)}, write built on ${String(sentVersion)})`
    )
    this.name = 'OrchStateConflict'
  }
}

// `name` also matches an error that crossed a module copy, where instanceof would miss it.
export function isStateConflict(e: unknown): e is OrchStateConflict {
  return e instanceof OrchStateConflict || (e instanceof Error && e.name === 'OrchStateConflict')
}

export const CONFLICT_ATTEMPTS = 5
/** Delay before attempt 2, 3, 4 and 5. */
export const CONFLICT_BACKOFF_MS = [50, 100, 200, 400]

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Re-runs a whole call after a state conflict. Any other error, or the last conflict, is thrown as is. */
export async function rerunOnConflict<T>(
  run: (attempt: number) => Promise<T>,
  o?: { attempts?: number; sleep?: (ms: number) => Promise<void>; mayRerun?: () => boolean }
): Promise<T> {
  const attempts = o?.attempts ?? CONFLICT_ATTEMPTS
  const sleep = o?.sleep ?? defaultSleep
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt)
    } catch (e) {
      if (!isStateConflict(e) || attempt >= attempts || !(o?.mayRerun?.() ?? true)) throw e
      await sleep(CONFLICT_BACKOFF_MS[Math.min(attempt - 1, CONFLICT_BACKOFF_MS.length - 1)])
    }
  }
}

/** Reads the state, applies `f`, and writes it; on a state conflict re-reads and re-applies.
 *  `f` returning null means nothing to write: returns false and writes nothing. */
export async function commitFresh(
  deps: Pick<OrchServerDeps, 'getState' | 'setState'>,
  f: (cur: OrchState) => OrchState | null,
  o?: { attempts?: number; sleep?: (ms: number) => Promise<void>; how?: { rollsBack?: true; allowMassDelete?: true } }
): Promise<boolean> {
  return rerunOnConflict(
    async () => {
      const next = f(deps.getState())
      if (next === null) return false
      await deps.setState(next, o?.how)
      return true
    },
    { attempts: o?.attempts, sleep: o?.sleep }
  )
}
