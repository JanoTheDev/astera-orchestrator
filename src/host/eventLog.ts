// The Host's public event log (SDK 1d; gap analysis decision 4): the events every commit makes, kept in memory for
// `events-poll` and appended to <profile>/orch/events.jsonl so the next Host reads them back. Always on, and apart
// from the Job Journal: the journal's opt-in, its SQLite file and its Run-keyed tables are not touched.
//
// **Bounded twice.** On disk: two segments, `events.jsonl` and the one before it, `events.1.jsonl`, each closed at
// EVENT_SEGMENT_EVENTS events or EVENT_SEGMENT_BYTES. In memory: the ring's EVENT_RETAIN_* (eventRing.ts). A
// cursor older than both reads on with `gap`.
//
// **JSONL, not SQLite**: appends are cheap, rotation bounds it, and a damaged line costs that line, not the log.
// **Writes are queued, never awaited by a commit**: the events are readable the moment they are made, and a write
// that fails keeps its lines and goes first with the next one. A Host that dies before a write lands loses those
// lines from disk only; their ids carry its boot, so the next Host's never repeat them (eventRing.ts).
import { appendFile, mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { EVENT_TYPES, type AsteraEvent } from '../core/publicContract'
import { derivePublicEvents } from '../core/orchestration/publicEvents'
import type { OrchState } from '../core/orchestration/state'
import { createEventRing, EVENT_ID, type EventRing } from '../core/events/eventRing'

export const EVENT_SEGMENT_EVENTS = 1000
export const EVENT_SEGMENT_BYTES = 4 * 1024 * 1024
export const EVENT_RETAIN_EVENTS = 2000
export const EVENT_RETAIN_CHARS = 8 * 1024 * 1024

const CURRENT = 'events.jsonl'
const PREVIOUS = 'events.1.jsonl'

export interface HostEventLog extends Pick<EventRing, 'read' | 'tail' | 'next'> {
  /** Reads the two segments back into memory. Once, at the Host's start, before any commit. */
  load(): Promise<void>
  /** This commit's events: made, kept, and queued for the disk. Never throws. */
  committed(prev: OrchState, next: OrchState): void
  /** Settles once every queued line was written or failed. */
  flushed(): Promise<void>
}

/** A line the log wrote: an object with an event id, a known type, a sequence, a time and a payload. */
const isEvent = (x: unknown): x is AsteraEvent => {
  if (x === null || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    EVENT_ID.test(e.id) &&
    typeof e.type === 'string' &&
    (EVENT_TYPES as readonly string[]).includes(e.type) &&
    Number.isSafeInteger(e.sequence) &&
    typeof e.occurredAt === 'string' &&
    e.payload !== null &&
    typeof e.payload === 'object'
  )
}

export function createHostEventLog(a: {
  /** <profile>/orch */
  dir: string
  /** This Host's bootId; its first 12 hex characters go in every id it makes. */
  bootId: string
  now(): string
  log(message: string): void
  derive?: typeof derivePublicEvents
  segmentEvents?: number
  segmentBytes?: number
  retainEvents?: number
  retainChars?: number
}): HostEventLog {
  const derive = a.derive ?? derivePublicEvents
  const segmentEvents = a.segmentEvents ?? EVENT_SEGMENT_EVENTS
  const segmentBytes = a.segmentBytes ?? EVENT_SEGMENT_BYTES
  const retainEvents = a.retainEvents ?? EVENT_RETAIN_EVENTS
  const ring = createEventRing({ boot: a.bootId.slice(0, 12), retainEvents, retainChars: a.retainChars ?? EVENT_RETAIN_CHARS })
  const current = path.join(a.dir, CURRENT)
  const previous = path.join(a.dir, PREVIOUS)

  /** Lines made and not yet on disk, oldest first. */
  let pending: string[] = []
  /** The current segment's size, so it is closed without reading it again. */
  let segmentLines = 0
  let segmentSize = 0
  let madeDir = false
  /** Set by a failed write, cleared by one that lands: one log line per failing streak. */
  let failing = false
  let queue: Promise<void> = Promise.resolve()

  const write = async (): Promise<void> => {
    if (pending.length === 0) return
    const lines = pending
    pending = []
    const text = lines.map((l) => `${l}\n`).join('')
    const size = Buffer.byteLength(text)
    try {
      if (!madeDir) {
        await mkdir(a.dir, { recursive: true })
        madeDir = true
      }
      if (segmentLines > 0 && (segmentLines + lines.length > segmentEvents || segmentSize + size > segmentBytes)) {
        await rename(current, previous)
        segmentLines = 0
        segmentSize = 0
      }
      await appendFile(current, text)
      segmentLines += lines.length
      segmentSize += size
      failing = false
    } catch (err) {
      pending = [...lines, ...pending]
      if (!failing) a.log(`events: could not write ${lines.length} event(s) to ${current}; they stay readable and go with the next write: ${String(err)}`)
      failing = true
      // A disk that stays shut must not grow this without end: past what memory keeps anyway, the oldest go. They are
      // lost from the file only, and a reader that was not following leaves them behind as a gap of the ring's.
      if (pending.length > retainEvents) {
        const dropped = pending.length - retainEvents
        pending = pending.slice(dropped)
        a.log(`events: dropped ${dropped} unwritten event(s) while the disk refuses the log`)
      }
    }
  }

  return {
    async load() {
      const held: Array<{ event: AsteraEvent; line: string }> = []
      let skipped = 0
      for (const file of [previous, current]) {
        let text: string
        try {
          text = await readFile(file, 'utf8')
        } catch {
          continue
        }
        const lines = text.split('\n').filter((l) => l.trim() !== '')
        for (const line of lines) {
          let event: unknown
          try {
            event = JSON.parse(line)
          } catch {
            event = null
          }
          if (isEvent(event)) held.push({ event, line })
          else skipped += 1
        }
        if (file === current) {
          segmentLines = lines.length
          segmentSize = Buffer.byteLength(text)
        }
      }
      if (skipped > 0) a.log(`events: skipped ${skipped} unreadable line(s) in the event log`)
      ring.restore(held)
    },
    committed(prev, next) {
      try {
        const drafts = derive(prev, next)
        if (drafts.length === 0) return
        pending.push(...ring.append(drafts, a.now()).map((w) => w.line))
        queue = queue.then(write)
      } catch (err) {
        a.log(`events: could not record this commit's events: ${String(err)}`)
      }
    },
    flushed: () => queue,
    read: (q) => ring.read(q),
    tail: () => ring.tail(),
    next: (ms) => ring.next(ms)
  }
}
