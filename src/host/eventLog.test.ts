// SDK 1d: the Host's public event log on disk. Every commit's events are kept in the ring and appended to
// <profile>/orch/events.jsonl; a new Host reads them back, so a cursor outlives the Host that gave it.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHostEventLog, type HostEventLog } from './eventLog'
import { emptyState, type OrchState } from '../core/orchestration/state'
import type { EventDraft } from '../core/orchestration/publicEvents'

const BOOT_A = '0123456789abcdef0123456789abcdef'
const BOOT_B = 'ba9876543210fedcba9876543210fedc'
const A = BOOT_A.slice(0, 12)
const B = BOOT_B.slice(0, 12)

let root: string
let dir: string
let logged: string[]
/** Every log a test opened, closed after it so no retry outlives the test's folder. */
const opened: HostEventLog[] = []

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'astera-events-'))
  dir = path.join(root, 'orch')
  logged = []
})
afterEach(() => {
  for (const log of opened.splice(0)) log.close()
  rmSync(root, { recursive: true, force: true })
})

/** A derive that answers the drafts it is told to, whatever the states. */
const scripted = (): { derive: (p: OrchState, n: OrchState) => EventDraft[]; next: EventDraft[][] } => {
  const next: EventDraft[][] = []
  return { next, derive: () => next.shift() ?? [] }
}
const draft = (type: EventDraft['type'], runId = 'run_1'): EventDraft => ({ type, runId, payload: { id: runId } })
const s0 = emptyState()
const s1: OrchState = { ...emptyState() }

const open = (bootId: string, derive: (p: OrchState, n: OrchState) => EventDraft[], over: Partial<Parameters<typeof createHostEventLog>[0]> = {}): HostEventLog => {
  // A retry far off unless a test asks for one: the tests below drive the writes themselves
  const log = createHostEventLog({ dir, bootId, now: () => 'T', log: (m) => logged.push(m), derive, retryMs: [60_000], ...over })
  opened.push(log)
  return log
}
const sequences = (file: string): number[] => lines(file).map((e) => (e as { sequence: number }).sequence)
const ids = (log: HostEventLog, after?: string): string[] => {
  const r = log.read({ after, limit: 100 })
  if ('error' in r) throw new Error(r.error)
  return r.events.map((e) => e.id)
}
const lines = (file: string): unknown[] =>
  readFileSync(path.join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l))

describe('the Host event log', () => {
  it('writes one JSON line per event of a commit', async () => {
    const d = scripted()
    const log = open(BOOT_A, d.derive)
    await log.load()
    d.next.push([draft('run.started'), draft('task.started')])
    log.committed(s0, s1)
    await log.flushed()
    expect(lines('events.jsonl')).toEqual([
      { id: `ev_${A}_1`, type: 'run.started', sequence: 1, occurredAt: 'T', runId: 'run_1', payload: { id: 'run_1' } },
      { id: `ev_${A}_2`, type: 'task.started', sequence: 2, occurredAt: 'T', runId: 'run_1', payload: { id: 'run_1' } }
    ])
    expect(ids(log)).toEqual([`ev_${A}_1`, `ev_${A}_2`])
  })

  // Plugin Phase 3 (events and notifications design N2): what no commit makes is recorded through `recorded`,
  // numbered on with the commits' events and kept the same way
  it('records drafts that no commit made, numbered with the rest, and writes them', async () => {
    const d = scripted()
    const log = open(BOOT_A, d.derive)
    await log.load()
    d.next.push([draft('run.started')])
    log.committed(s0, s1)
    log.recorded([{ type: 'session.input_needed', sessionId: 's1', payload: { session: { id: 's1', kind: 'chat' }, prompt: 'question' } }])
    log.recorded([])
    await log.flushed()
    expect(lines('events.jsonl')).toEqual([
      { id: `ev_${A}_1`, type: 'run.started', sequence: 1, occurredAt: 'T', runId: 'run_1', payload: { id: 'run_1' } },
      { id: `ev_${A}_2`, type: 'session.input_needed', sequence: 2, occurredAt: 'T', sessionId: 's1', payload: { session: { id: 's1', kind: 'chat' }, prompt: 'question' } }
    ])
  })

  it('a new Host reads session events back with their session id', async () => {
    const a = open(BOOT_A, () => [])
    await a.load()
    a.recorded([{ type: 'session.limit_waiting', sessionId: 's1', payload: { session: { id: 's1', kind: 'terminal' }, scope: 'weekly' } }])
    await a.flushed()
    const b = open(BOOT_B, () => [])
    await b.load()
    const r = b.read({ limit: 10 })
    if ('error' in r) throw new Error(r.error)
    expect(r.events).toEqual([{ id: `ev_${A}_1`, type: 'session.limit_waiting', sequence: 1, occurredAt: 'T', sessionId: 's1', payload: { session: { id: 's1', kind: 'terminal' }, scope: 'weekly' } }])
  })

  it('a recorded draft the ring cannot take is logged and nothing throws', async () => {
    const log = open(BOOT_A, () => [])
    await log.load()
    const poisoned = {
      type: 'session.input_needed',
      sessionId: 's1',
      get payload(): unknown {
        throw new Error('boom')
      }
    } as unknown as EventDraft
    expect(() => log.recorded([poisoned])).not.toThrow()
    expect(logged.some((m) => m.includes('could not record') && m.includes('boom'))).toBe(true)
  })

  it('writes nothing, and makes no file, for a commit with no events', async () => {
    const log = open(BOOT_A, () => [])
    await log.load()
    log.committed(s0, s1)
    await log.flushed()
    expect(existsSync(dir)).toBe(false)
  })

  it('a new Host reads the events back, numbers on, and reads on from an old cursor', async () => {
    const d = scripted()
    const a = open(BOOT_A, d.derive)
    await a.load()
    d.next.push([draft('run.started'), draft('task.started')])
    a.committed(s0, s1)
    await a.flushed()

    const e = scripted()
    const b = open(BOOT_B, e.derive)
    await b.load()
    expect(ids(b)).toEqual([`ev_${A}_1`, `ev_${A}_2`])
    e.next.push([draft('task.completed')])
    b.committed(s0, s1)
    await b.flushed()
    const r = b.read({ after: `ev_${A}_2`, limit: 100 })
    expect(r).toEqual({ events: [expect.objectContaining({ id: `ev_${B}_3`, sequence: 3 })], cursor: `ev_${B}_3`, gap: false })
  })

  it('skips a line it cannot read, and says so once', async () => {
    mkdirSync(dir, { recursive: true })
    const good = { id: `ev_${A}_1`, type: 'run.started', sequence: 1, occurredAt: 'T', runId: 'run_1', payload: {} }
    const unknown = { ...good, id: `ev_${A}_2`, sequence: 2, type: 'run.cancelled' }
    const noPayload = { id: `ev_${A}_3`, type: 'run.started', sequence: 3, occurredAt: 'T' }
    writeFileSync(path.join(dir, 'events.jsonl'), [JSON.stringify(good), '{not json', JSON.stringify(unknown), JSON.stringify(noPayload), ''].join('\n'))
    const log = open(BOOT_B, () => [])
    await log.load()
    expect(ids(log)).toEqual([`ev_${A}_1`])
    expect(logged.filter((m) => m.includes('unreadable'))).toEqual(['events: skipped 3 unreadable line(s) in the event log'])
  })

  it('moves a full segment aside and reads both back in order', async () => {
    const d = scripted()
    const a = open(BOOT_A, d.derive, { segmentEvents: 2 })
    await a.load()
    for (const t of ['run.started', 'task.started', 'task.completed'] as const) {
      d.next.push([draft(t)])
      a.committed(s0, s1)
      await a.flushed()
    }
    expect(lines('events.1.jsonl').map((e) => (e as { sequence: number }).sequence)).toEqual([1, 2])
    expect(lines('events.jsonl').map((e) => (e as { sequence: number }).sequence)).toEqual([3])
    const b = open(BOOT_B, () => [], { segmentEvents: 2 })
    await b.load()
    expect(ids(b)).toEqual([`ev_${A}_1`, `ev_${A}_2`, `ev_${A}_3`])
  })

  it('keeps the events readable when the disk refuses them, says so once, and writes them with the next', async () => {
    // A file where the folder should be: every write fails
    writeFileSync(dir, 'in the way')
    const d = scripted()
    const log = open(BOOT_A, d.derive)
    await log.load()
    d.next.push([draft('run.started')])
    log.committed(s0, s1)
    await log.flushed()
    d.next.push([draft('task.started')])
    log.committed(s0, s1)
    await log.flushed()
    expect(ids(log)).toEqual([`ev_${A}_1`, `ev_${A}_2`])
    expect(logged.filter((m) => m.startsWith('events: could not write'))).toHaveLength(1)
    rmSync(dir)
    d.next.push([draft('task.completed')])
    log.committed(s0, s1)
    await log.flushed()
    expect(sequences('events.jsonl')).toEqual([1, 2, 3])
    // A failed write may have left part of a line: the next one starts on a line of its own
    expect(readFileSync(path.join(dir, 'events.jsonl'), 'utf8').startsWith('\n')).toBe(true)
  })

  // Final review Important 1: a write that failed went again only with the next commit that made events
  it('writes held lines by itself once the disk takes them, with no commit to carry them', async () => {
    writeFileSync(dir, 'in the way')
    const d = scripted()
    const log = open(BOOT_A, d.derive, { retryMs: [20, 40] })
    await log.load()
    d.next.push([draft('run.started')])
    log.committed(s0, s1)
    await log.flushed()
    rmSync(dir)
    await vi.waitFor(() => expect(existsSync(path.join(dir, 'events.jsonl'))).toBe(true), { timeout: 3000 })
    await log.flushed()
    expect(sequences('events.jsonl')).toEqual([1])
  })

  it('flushed() writes what a failed write held: the Host awaits it on its way out', async () => {
    writeFileSync(dir, 'in the way')
    const d = scripted()
    const log = open(BOOT_A, d.derive)
    await log.load()
    d.next.push([draft('run.started')])
    log.committed(s0, s1)
    await log.flushed()
    rmSync(dir)
    await log.flushed()
    expect(sequences('events.jsonl')).toEqual([1])
    const index = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')
    expect(index).toMatch(/disposeWithin\(eventLog\.flushed\(\), LEAVE_LOG_FLUSH_CAP_MS/)
    expect(index).toMatch(/eventLog\.close\(\)/)
  })

  // Final review Important 2: a crash can leave the last line torn, and the next append ran on into it
  it('a torn last line does not swallow the next Host’s first event', async () => {
    mkdirSync(dir, { recursive: true })
    const good = { id: `ev_${A}_1`, type: 'run.started', sequence: 1, occurredAt: 'T', runId: 'run_1', payload: {} }
    writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(good)}\n{"id":"ev_${A}_2","ty`)
    const d = scripted()
    const b = open(BOOT_B, d.derive)
    await b.load()
    d.next.push([draft('task.completed')])
    b.committed(s0, s1)
    await b.flushed()
    const c = open(BOOT_A, () => [])
    await c.load()
    expect(ids(c)).toEqual([`ev_${A}_1`, `ev_${B}_2`])
  })

  // Final review Minor 2: a removed file made every later rotation fail
  it('carries on when its file was removed under it', async () => {
    const d = scripted()
    const log = open(BOOT_A, d.derive, { segmentEvents: 1 })
    await log.load()
    d.next.push([draft('run.started')])
    log.committed(s0, s1)
    await log.flushed()
    rmSync(path.join(dir, 'events.jsonl'))
    d.next.push([draft('task.started')])
    log.committed(s0, s1)
    await log.flushed()
    expect(sequences('events.jsonl')).toEqual([2])
    d.next.push([draft('task.completed')])
    log.committed(s0, s1)
    await log.flushed()
    expect(sequences('events.1.jsonl')).toEqual([2])
    expect(sequences('events.jsonl')).toEqual([3])
  })

  it('appends without moving the segment when it cannot be moved, and says so once', async () => {
    mkdirSync(path.join(dir, 'events.1.jsonl', 'in the way'), { recursive: true })
    const d = scripted()
    const log = open(BOOT_A, d.derive, { segmentEvents: 1 })
    await log.load()
    for (const t of ['run.started', 'task.started', 'task.completed'] as const) {
      d.next.push([draft(t)])
      log.committed(s0, s1)
      await log.flushed()
    }
    expect(sequences('events.jsonl')).toEqual([1, 2, 3])
    expect(logged.filter((m) => m.startsWith('events: could not move'))).toHaveLength(1)
  })

  // Final review Minor 3: a file it could not read was taken for an empty one, in silence
  it('says when it cannot read a segment', async () => {
    mkdirSync(path.join(dir, 'events.jsonl'), { recursive: true })
    const log = open(BOOT_A, () => [])
    await log.load()
    expect(logged).toEqual([expect.stringMatching(/^events: could not read .*events\.jsonl/)])
  })

  it('holds at most as many unwritten lines as it keeps events, and says what it dropped', async () => {
    writeFileSync(dir, 'in the way')
    const d = scripted()
    const log = open(BOOT_A, d.derive, { retainEvents: 2 })
    await log.load()
    for (let i = 0; i < 3; i++) {
      d.next.push([draft('task.started')])
      log.committed(s0, s1)
      await log.flushed()
    }
    // Final review Minor 1: one line for the streak, not one per failed write
    expect(logged.filter((m) => m.includes('dropped'))).toEqual([])
    expect(logged.filter((m) => m.startsWith('events: could not write'))).toHaveLength(1)
    rmSync(dir)
    d.next.push([draft('task.completed')])
    log.committed(s0, s1)
    await log.flushed()
    expect(sequences('events.jsonl')).toEqual([2, 3, 4])
    expect(logged.filter((m) => m.includes('dropped'))).toEqual([expect.stringContaining('1 unwritten event')])
  })

  it('a derive that throws is logged and the commit goes on', async () => {
    const log = open(BOOT_A, () => {
      throw new Error('boom')
    })
    await log.load()
    expect(() => log.committed(s0, s1)).not.toThrow()
    expect(logged).toEqual([expect.stringContaining('boom')])
  })
})
