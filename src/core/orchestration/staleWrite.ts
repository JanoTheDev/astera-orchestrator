import type { OrchState } from './state'

/**
 * **A whole-state write built on a state that has since moved on** (the lost review Dispatches, 2026-11-02).
 *
 * `setState` takes a whole state, so a flow that reads the state, awaits, and then commits what it built from that
 * read erases every commit that landed in between: last writer wins. The command chain keeps two commands apart, but
 * not a command and a flow outside the chain (a review start, a validation's tail, a tick), and not a command whose
 * own awaits come between its read and its commit. The case that cost work: `worker-start` read the state, awaited
 * its account choice, and committed `openDispatch` of that read over four review Dispatches the review starts had
 * opened meanwhile — the reviewers ran, and their Dispatches were gone from memory and disk.
 *
 * **Every state knows the state it was built on.** A committed state carries itself under `BASE`, an enumerable
 * symbol: the `{ ...s, tasks }` every transition makes copies it, so a state derived from `s` names `s` as its base
 * without any writer saying so. JSON (the file, the socket) does not carry symbols, so nothing outside memory sees it.
 * At the commit, a write whose base is not the state held now is **rebased**: what the writer changed from its base
 * is applied to the current state, entity by entity (every collection is keyed by `id`), and what others committed
 * in the meantime stays. The commit can no longer erase a concurrent one by being late.
 */
export const BASE: unique symbol = Symbol('orch.base')

type Based = OrchState & { [BASE]?: OrchState }

/** The state `s` was built on, or `undefined` for a state with no known origin (one parsed from JSON). */
export const baseOf = (s: OrchState): OrchState | undefined => (s as Based)[BASE]

/** Marks `s` as a committed state: every state derived from it by a spread names it as its base. In place, so a
 *  state's identity is kept (callers compare `getState()` results by reference). */
export function stampCommitted(s: OrchState): OrchState {
  ;(s as Based)[BASE] = s
  return s
}

export interface Rebased {
  state: OrchState
  /** Entities the writer did not see, committed by others since its base, that the rebase kept (`dispatches/dsp_…`). */
  kept: string[]
  /** Entities the writer and another commit both changed since the base: the writer's value is taken. */
  conflicts: string[]
}

type Entity = { id: string }
const isEntityArray = (v: unknown): v is Entity[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && typeof (x as Entity).id === 'string')

/**
 * The three-way merge: `given` was built on `base`; `current` is what is held now. Per top-level key, a collection
 * the writer left alone is the current one, one nobody else touched is the writer's, and one both touched is merged
 * by `id`: an entity the writer did not change is the current one (or stays deleted); one it changed, added or
 * deleted takes the writer's side. Changes are seen by reference — transitions copy what they change and keep the
 * rest — so this costs nothing for the entities nobody touched.
 */
export function rebase(base: OrchState, given: OrchState, current: OrchState): Rebased {
  const kept: string[] = []
  const conflicts: string[] = []
  const out: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) }
  const b = base as unknown as Record<string, unknown>
  const g = given as unknown as Record<string, unknown>
  const c = current as unknown as Record<string, unknown>
  for (const key of new Set([...Object.keys(c), ...Object.keys(g)])) {
    const bv = b[key]
    const gv = g[key]
    const cv = c[key]
    if (gv === bv) continue // the writer left it alone: the current value stands
    if (cv === bv) {
      if (gv === undefined) delete out[key]
      else out[key] = gv // nobody else touched it
      continue
    }
    if (!isEntityArray(gv) || !isEntityArray(cv) || (bv !== undefined && !isEntityArray(bv))) {
      // Not a collection: the writer's value, as before this rebase existed — and said, since both moved it.
      conflicts.push(key)
      out[key] = gv
      continue
    }
    const bm = new Map((bv ?? []).map((e) => [e.id, e]))
    const gm = new Map(gv.map((e) => [e.id, e]))
    const merged: Entity[] = []
    for (const ce of cv) {
      const be = bm.get(ce.id)
      const ge = gm.get(ce.id)
      if (ge === be) {
        // The writer did not touch it: what was committed meanwhile stands.
        merged.push(ce)
        if (ce !== be) kept.push(`${key}/${ce.id}`)
        continue
      }
      if (ce !== be) conflicts.push(`${key}/${ce.id}`)
      if (ge !== undefined) merged.push(ge) // changed (or re-added) by the writer; absent: the writer deleted it
    }
    // What the writer added, in its order, after what is held now.
    const inCurrent = new Set(cv.map((e) => e.id))
    for (const ge of gv) {
      if (inCurrent.has(ge.id)) continue
      const be = bm.get(ge.id)
      if (ge === be) {
        kept.push(`${key}/${ge.id} (deleted)`) // deleted meanwhile by another commit, untouched by the writer
        continue
      }
      if (be !== undefined) conflicts.push(`${key}/${ge.id}`) // the writer changed what another commit deleted
      merged.push(ge)
    }
    out[key] = merged
  }
  return { state: out as unknown as OrchState, kept, conflicts }
}
