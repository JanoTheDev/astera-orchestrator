// The public events the Host holds in memory (SDK 1d): numbered, kept within bounds, read from a cursor, waited on.
// src/host/eventLog.ts fills it from each commit and from the files at start; `events-poll` reads it.
//
// **An id carries the boot of the Host that made it** (`ev_<12 hex>_<sequence>`). The sequence goes on across Host
// restarts (the log reloads the last one), but a Host that dies after delivering an event and before writing it
// leaves a number the next Host hands out again. The boot keeps the two ids apart, and it lets a cursor be placed
// exactly: within the events of its own boot, which are in order with no hole, and never by its number alone.
import type { AsteraEvent } from '../publicContract'
import type { EventDraft } from '../orchestration/publicEvents'

/** An event id: the boot (the Host's bootId cut to 12 hex characters) and the sequence, no leading zero. */
export const EVENT_ID = /^ev_([0-9a-f]{12})_(0|[1-9][0-9]*)$/

export const eventId = (boot: string, sequence: number): string => `ev_${boot}_${sequence}`

export interface RingRead {
  events: AsteraEvent[]
  /** Where to read on from: the last event looked at, given or skipped by the filter. */
  cursor: string
  /** Events between the cursor and the first one given are gone: older than the ring holds, or of a log it does
   *  not hold. */
  gap: boolean
}

export interface EventRing {
  /** Numbers the drafts, keeps them, and wakes whoever waits. Answers each event with its JSON line. */
  append(drafts: readonly EventDraft[], occurredAt: string): Array<{ event: AsteraEvent; line: string }>
  /** The events the files held, oldest first. Called once, before any append. */
  restore(entries: ReadonlyArray<{ event: AsteraEvent; line: string }>): void
  read(q: { after?: string; types?: ReadonlySet<string>; limit: number }): RingRead | { error: string }
  /** A cursor that reads only what comes after now. */
  tail(): string
  /** Settles at the next append, or after `ms`. */
  next(ms: number): Promise<void>
  lastSequence(): number
}

interface Entry {
  event: AsteraEvent
  line: string
  boot: string
}

export function createEventRing(a: {
  /** This Host's boot, 12 hex characters. */
  boot: string
  /** At most this many events are held, */
  retainEvents: number
  /** and at most this many characters of their lines; the newest event is always held. */
  retainChars: number
}): EventRing {
  const entries: Entry[] = []
  let chars = 0
  let last = 0
  const waiters = new Set<() => void>()

  const bootOf = (id: string): string | null => EVENT_ID.exec(id)?.[1] ?? null
  const trim = (): void => {
    while (entries.length > 1 && (entries.length > a.retainEvents || chars > a.retainChars)) chars -= entries.shift()!.line.length
  }
  const tail = (): string => (entries.length > 0 ? entries[entries.length - 1].event.id : eventId(a.boot, last))

  /** Where a cursor reads on from, and whether events before that were lost. */
  const locate = (boot: string, seq: number): { start: number; gap: boolean } => {
    let first = -1
    let lastOwn = -1
    for (let i = 0; i < entries.length; i++)
      if (entries[i].boot === boot) {
        if (first < 0) first = i
        lastOwn = i
      }
    if (first >= 0) {
      // That boot's events are in order: the ones before its first held one fell off the front, and everything older
      // with them.
      if (seq < entries[first].event.sequence - 1) return { start: first, gap: true }
      // At or past its last: a Host that died before writing what it had delivered leaves a cursor past it, and
      // the caller had those.
      if (seq >= entries[lastOwn].event.sequence) return { start: lastOwn + 1, gap: false }
      // A hole inside that boot (lines a shut disk dropped, a torn line) is a gap like one at the front
      for (let i = first; i <= lastOwn; i++)
        if (entries[i].boot === boot && entries[i].event.sequence > seq) return { start: i, gap: entries[i].event.sequence > seq + 1 }
    }
    // Nothing of this Host's boot yet: what comes after now
    if (boot === a.boot) return { start: entries.length, gap: false }
    // A boot the ring does not hold. A cursor that had seen nothing (a tail taken while the ring was empty) has
    // missed nothing the ring still holds; any other may have.
    return { start: 0, gap: seq > 0 }
  }

  return {
    append(drafts, occurredAt) {
      const written = drafts.map((d) => {
        const sequence = ++last
        const event = {
          id: eventId(a.boot, sequence),
          type: d.type,
          sequence,
          occurredAt,
          ...(d.projectId !== undefined ? { projectId: d.projectId } : {}),
          ...(d.jobId !== undefined ? { jobId: d.jobId } : {}),
          ...(d.runId !== undefined ? { runId: d.runId } : {}),
          ...(d.taskId !== undefined ? { taskId: d.taskId } : {}),
          ...(d.sessionId !== undefined ? { sessionId: d.sessionId } : {}),
          payload: d.payload
        } as AsteraEvent
        const line = JSON.stringify(event)
        entries.push({ event, line, boot: a.boot })
        chars += line.length
        return { event, line }
      })
      trim()
      if (written.length > 0) for (const wake of [...waiters]) wake()
      return written
    },
    restore(held) {
      const seen = new Set<string>()
      for (const { event, line } of held) {
        const boot = bootOf(event.id)
        // A write retried after a partial one can leave a line twice: the first is the one kept
        if (boot === null || seen.has(event.id)) continue
        seen.add(event.id)
        entries.push({ event, line, boot })
        chars += line.length
        last = Math.max(last, event.sequence)
      }
      trim()
    },
    read(q) {
      let start = 0
      let gap = false
      if (q.after !== undefined) {
        const m = EVENT_ID.exec(q.after)
        if (m === null) return { error: `not an event id: ${q.after}` }
        const seq = Number(m[2])
        if (!Number.isSafeInteger(seq)) return { error: `not an event id: ${q.after}` }
        ;({ start, gap } = locate(m[1], seq))
      }
      const events: AsteraEvent[] = []
      let scanned = -1
      for (let i = start; i < entries.length && events.length < q.limit; i++) {
        scanned = i
        const e = entries[i].event
        if (q.types === undefined || q.types.has(e.type)) events.push(e)
      }
      // Nothing looked at: the ring ends at `start`, so the event before it (or the tail) is where to read on from
      const cursor = scanned >= 0 ? entries[scanned].event.id : start > 0 ? entries[start - 1].event.id : tail()
      return { events, cursor, gap }
    },
    tail,
    next(ms) {
      return new Promise<void>((resolve) => {
        if (ms <= 0) return resolve()
        const done = (): void => {
          clearTimeout(timer)
          waiters.delete(done)
          resolve()
        }
        const timer = setTimeout(done, ms)
        waiters.add(done)
      })
    },
    lastSequence: () => last
  }
}
