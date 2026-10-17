// The Host's public event log (SDK 1d; gap analysis decision 4): the events every commit makes, and the session events
// no commit makes (plugin Phase 3, `recorded`), kept in memory for `events-poll` and appended to
// <profile>/orch/events.jsonl so the next Host reads them back. Always on, and apart
// from the Job Journal: the journal's opt-in, its SQLite file and its Run-keyed tables are not touched.
//
// **Bounded twice.** On disk: two segments, `events.jsonl` and the one before it, `events.1.jsonl`, each closed at
// EVENT_SEGMENT_EVENTS events or EVENT_SEGMENT_BYTES. In memory: the ring's EVENT_RETAIN_* (eventRing.ts). A
// cursor older than both reads on with `gap`.
//
// **JSONL, not SQLite**: appends are cheap, rotation bounds it, and a damaged line costs that line, not the log.
// **Writes are queued, never awaited by a commit**: the events are readable the moment they are made. A write that
// fails keeps its lines; they go again on a timer of their own (EVENT_RETRY_MS) or with the next write, whichever
// comes first, and the Host awaits `flushed()` on its way out (final review Important 1). A Host that dies before a
// write lands loses those lines from disk only; their ids carry its boot, so the next Host's never repeat them
// (eventRing.ts).
//
// **A torn line stays one line.** A crash or a failed write can leave the file ending mid-line; the next write then
// starts with a line break of its own, so the torn line is skipped at the next load and the new events are not
// glued to it (final review Important 2).
import { appendFile, mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { EVENT_TYPES, type AsteraEvent } from '../core/publicContract'
import { derivePublicEvents } from '../core/orchestration/publicEvents'
import type { OrchState } from '../core/orchestration/state'
import { createEventRing, EVENT_ID, type EventRing, type LogDraft } from '../core/events/eventRing'

export const EVENT_SEGMENT_EVENTS = 1000
export const EVENT_SEGMENT_BYTES = 4 * 1024 * 1024
export const EVENT_RETAIN_EVENTS = 2000
export const EVENT_RETAIN_CHARS = 8 * 1024 * 1024
/** How long after a failed write it is tried again on its own: the first time, then every later time. */
export const EVENT_RETRY_MS = Object.freeze([1000, 5000] as const)

/** A segment that cannot be read for a reason other than its absence (another process holding it) is read again
 *  this many times, this far apart, before the load goes on without it. */
const READ_TRIES = 3
const READ_RETRY_MS = 50

export interface HostEventLog extends Pick<EventRing, 'read' | 'tail' | 'next'> {
  /** Reads the two segments back into memory. Once, at the Host's start, before any commit. */
  load(): Promise<void>
  /** This commit's events: made, kept, and queued for the disk. Never throws. */
  committed(prev: OrchState, next: OrchState): void
  /** Events no commit makes (plugin Phase 3: the session events, sessionEvents.ts), made, kept and queued the same
   *  way, numbered on with the commits'. Never throws. */
  recorded(drafts: readonly LogDraft[]): void
  /** Writes what is held, a failed write's lines included, and settles once that write landed or failed. */
  flushed(): Promise<void>
  /** No more retries on a timer: the Host is leaving. Lines still held are lost from disk. */
  close(): void
}

/** A line the log wrote: an object with an event id, a known type, a sequence, a time and a payload. */
const isEvent = (x: unknown, types: readonly string[]): x is AsteraEvent => {
  if (x === null || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    EVENT_ID.test(e.id) &&
    typeof e.type === 'string' &&
    types.includes(e.type) &&
    Number.isSafeInteger(e.sequence) &&
    typeof e.occurredAt === 'string' &&
    e.payload !== null &&
    typeof e.payload === 'object'
  )
}

const codeOf = (err: unknown): unknown => (err as { code?: unknown } | null)?.code

export function createHostEventLog(a: {
  /** <profile>/orch */
  dir: string
  /** This Host's bootId; its first 12 hex characters go in every id it makes. */
  bootId: string
  now(): string
  log(message: string): void
  derive?: (prev: OrchState, next: OrchState) => readonly LogDraft[]
  /** W3-A: a second log in the same dir (the activity feed's): its segments are `<name>.jsonl` and `<name>.1.jsonl`,
   *  and a line read back must have one of `types`. Default: the public event log, `events`, EVENT_TYPES. */
  name?: string
  types?: readonly string[]
  segmentEvents?: number
  segmentBytes?: number
  retainEvents?: number
  retainChars?: number
  retryMs?: readonly number[]
}): HostEventLog {
  const derive = a.derive ?? derivePublicEvents
  const segmentEvents = a.segmentEvents ?? EVENT_SEGMENT_EVENTS
  const segmentBytes = a.segmentBytes ?? EVENT_SEGMENT_BYTES
  const retainEvents = a.retainEvents ?? EVENT_RETAIN_EVENTS
  const retryMs = a.retryMs ?? EVENT_RETRY_MS
  const ring = createEventRing({ boot: a.bootId.slice(0, 12), retainEvents, retainChars: a.retainChars ?? EVENT_RETAIN_CHARS })
  const name = a.name ?? 'events'
  const types: readonly string[] = a.types ?? EVENT_TYPES
  const current = path.join(a.dir, `${name}.jsonl`)
  const previous = path.join(a.dir, `${name}.1.jsonl`)

  /** Lines made and not yet on disk, oldest first. */
  let pending: string[] = []
  /** The current segment's size, so it is closed without reading it again. */
  let segmentLines = 0
  let segmentSize = 0
  let madeDir = false
  /** The file may end mid-line (a torn last line at the load, a failed write): the next write starts a new line. */
  let needsBreak = false
  /** Set by a failed write, cleared by one that lands: one log line per failing streak. */
  let failing = false
  /** Unwritten lines dropped in this streak, told once the disk takes the log again. */
  let dropped = 0
  /** Set while the segment cannot be moved aside: one log line until it can. */
  let stuckSegment = false
  let retries = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let queue: Promise<void> = Promise.resolve()

  const enqueue = (): Promise<void> => (queue = queue.then(write))

  /** Drafts made into events, kept, and queued for the disk. */
  const take = (drafts: readonly LogDraft[]): void => {
    if (drafts.length === 0) return
    pending.push(...ring.append(drafts, a.now()).map((w) => w.line))
    void enqueue()
  }

  const retryLater = (): void => {
    if (closed || retryTimer !== null) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void enqueue()
    }, retryMs[Math.min(retries, retryMs.length - 1)])
    retryTimer.unref?.()
    retries += 1
  }

  /** Closes the full segment: `events.jsonl` becomes `events.1.jsonl`. A file already gone has nothing to move; one
   *  that cannot be moved (Windows: another process holds the old segment) stays and grows until it can. */
  const rotate = async (): Promise<void> => {
    try {
      await rename(current, previous)
    } catch (err) {
      if (codeOf(err) !== 'ENOENT') {
        if (!stuckSegment) a.log(`events: could not move ${current} aside, so it grows past its bound until it can: ${String(err)}`)
        stuckSegment = true
        return
      }
    }
    stuckSegment = false
    segmentLines = 0
    segmentSize = 0
  }

  async function write(): Promise<void> {
    if (pending.length === 0) return
    const lines = pending
    pending = []
    const text = (needsBreak ? '\n' : '') + lines.map((l) => `${l}\n`).join('')
    const size = Buffer.byteLength(text)
    try {
      if (!madeDir) {
        await mkdir(a.dir, { recursive: true })
        madeDir = true
      }
      if (segmentLines > 0 && (segmentLines + lines.length > segmentEvents || segmentSize + size > segmentBytes)) await rotate()
      await appendFile(current, text)
      segmentLines += lines.length
      segmentSize += size
      needsBreak = false
      if (failing && dropped > 0) a.log(`events: the disk took the log again; ${dropped} unwritten event(s) were dropped while it refused it`)
      failing = false
      dropped = 0
      retries = 0
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
    } catch (err) {
      pending = [...lines, ...pending]
      // Part of the text may have landed: whatever comes next starts on a line of its own
      needsBreak = true
      if (!failing) a.log(`events: could not write ${lines.length} event(s) to ${current}; they stay readable and are written again later: ${String(err)}`)
      failing = true
      // A disk that stays shut must not grow this without end: past what memory keeps anyway, the oldest go. They are
      // lost from the file only, and a reader whose cursor falls among them after a restart reads on with a gap.
      if (pending.length > retainEvents) {
        dropped += pending.length - retainEvents
        pending = pending.slice(pending.length - retainEvents)
      }
      retryLater()
    }
  }

  /** A segment's text, or null when there is none. A segment that cannot be read is tried again, then logged. */
  const readSegment = async (file: string): Promise<string | null> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await readFile(file, 'utf8')
      } catch (err) {
        if (codeOf(err) === 'ENOENT') return null
        if (attempt >= READ_TRIES) {
          a.log(`events: could not read ${file}, so its events are not read back and later numbers may repeat theirs: ${String(err)}`)
          return null
        }
        await new Promise((r) => setTimeout(r, READ_RETRY_MS))
      }
    }
  }

  return {
    async load() {
      const held: Array<{ event: AsteraEvent; line: string }> = []
      let skipped = 0
      for (const file of [previous, current]) {
        const text = await readSegment(file)
        if (text === null) continue
        const lines = text.split('\n').filter((l) => l.trim() !== '')
        for (const line of lines) {
          let event: unknown
          try {
            event = JSON.parse(line)
          } catch {
            event = null
          }
          if (isEvent(event, types)) held.push({ event, line })
          else skipped += 1
        }
        if (file === current) {
          segmentLines = lines.length
          segmentSize = Buffer.byteLength(text)
          // A crash mid-write left the last line torn: the first write must not run on into it
          needsBreak = text.length > 0 && !text.endsWith('\n')
        }
      }
      if (skipped > 0) a.log(`events: skipped ${skipped} unreadable line(s) in the event log`)
      ring.restore(held)
    },
    committed(prev, next) {
      try {
        take(derive(prev, next))
      } catch (err) {
        a.log(`events: could not record this commit's events: ${String(err)}`)
      }
    },
    recorded(drafts) {
      try {
        take(drafts)
      } catch (err) {
        a.log(`events: could not record ${drafts.length} event(s): ${String(err)}`)
      }
    },
    flushed: () => (pending.length > 0 ? enqueue() : queue),
    close() {
      closed = true
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
    },
    read: (q) => ring.read(q),
    tail: () => ring.tail(),
    next: (ms) => ring.next(ms)
  }
}
