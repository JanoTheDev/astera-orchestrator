// The Jobs sidebar push ('orch:state'), out of ipc.ts so its rules can be tested (ipc.ts imports electron).
//
// Performance audit M1: the push hangs off every orchestration commit, and a worker's heartbeat, a Delivery and a
// status message are each a commit. Folding the project and serializing both the new fold and the last one sent on
// each of them is what kept main busy while a Job ran. So:
// - a burst of commits in one tick folds once, for the newest state (the renderer only ever shows the newest);
// - the last stamped snapshot is kept as its string, made once per fold rather than again for every compare.
// The compare is still the serialized one `sameSnapshot` documents (core/orchestration/view.ts), and sound for the
// same reason: both sides come out of snapshotFor.
//
// Every snapshot orch.list returns or this sends is stamped with the project the renderer named and a version that
// moves only when that content does: the renderer drops another project's push and keeps the object it holds on an
// equal version without serializing anything (acceptSnapshot, core/orchestration/snapshot.ts).
import type { OrchState } from '../core/orchestration/state'
import type { OrchSnapshot } from '../core/types'

export interface OrchPushDeps {
  fold(state: OrchState, project: string): OrchSnapshot
  send(snapshot: OrchSnapshot): void
  log(line: string): void
  /** Defaults to setImmediate: after the commit that pushed, before the next I/O. */
  schedule?: (fn: () => void) => void
}

export interface OrchPush {
  /** A commit landed. Folded later in this tick, with whatever state is newest by then. */
  push(state: OrchState): void
  /** `content` tagged with `tag` (the project path as the renderer sent it) and its version: the same as the last one
   *  stamped for that tag when the content is, else a new one. */
  stamp(tag: string, content: OrchSnapshot): OrchSnapshot
  /** The renderer asked for this project and now holds `sent` (orch.list's reply, stamped): pushes fold `project` and
   *  carry `sent`'s tag. */
  watch(project: string, sent: OrchSnapshot): void
  /** The renderer stopped asking (orch.unwatch); a push already queued sends nothing. */
  unwatch(): void
  project(): string | null
  /** The last state pushed, for a re-push after a worktree presence answer. */
  lastPushed(): OrchState | null
}

export function createOrchPush(d: OrchPushDeps): OrchPush {
  const schedule = d.schedule ?? ((fn: () => void): void => void setImmediate(fn))
  let project: string | null = null
  let tag: string | null = null
  let sentVersion: number | undefined
  // One record, not one per project: a switch back folds again anyway, and the record holds a whole snapshot's string
  let stamped: { tag: string; key: string; version: number } | null = null
  let version = 0
  const stamp = (t: string, content: OrchSnapshot): OrchSnapshot => {
    const key = JSON.stringify(content)
    if (stamped === null || stamped.tag !== t || stamped.key !== key) stamped = { tag: t, key, version: ++version }
    return { ...content, project: t, version: stamped.version }
  }
  let last: OrchState | null = null
  let queued = false
  const flush = (): void => {
    queued = false
    if (project === null || tag === null || last === null) return
    // The push used to run inside the awaited setState, so a throw would reject a write already persisted; it runs
    // later now, and a throw would only end this tick. Logged either way: a fold that throws is a real defect.
    try {
      const next = stamp(tag, d.fold(last, project))
      if (next.version === sentVersion) return
      sentVersion = next.version
      d.send(next)
    } catch (err) {
      d.log(`orch:state push failed project=${project}: ${String(err)}`)
    }
  }
  return {
    push: (state) => {
      last = state
      if (project === null || queued) return
      queued = true
      schedule(flush)
    },
    stamp,
    watch: (p, sent) => {
      project = p
      tag = sent.project ?? p
      sentVersion = sent.version
    },
    unwatch: () => {
      project = null
      tag = null
      sentVersion = undefined
    },
    project: () => project,
    lastPushed: () => last
  }
}
