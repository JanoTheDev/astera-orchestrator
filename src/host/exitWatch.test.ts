import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fsSync from 'node:fs'
import { EXIT_RECORD, HEARTBEAT_MS, previousHostLines, readLogTail, watchExit, type ExitFs } from './exitWatch'

const DIR = path.join('profile', 'host')
const FILE = path.join(DIR, EXIT_RECORD)

function fakes(startMs = 1_000_000) {
  const files = new Map<string, string>()
  const fs: ExitFs = {
    writeFileSync: (p, d) => void files.set(p, d),
    readFileSync: (p) => {
      const v = files.get(p)
      if (v === undefined) throw new Error('ENOENT')
      return v
    },
    mkdirSync: () => undefined
  }
  let t = startMs
  const exits: Array<(code: number) => void> = []
  const lines: string[] = []
  const closes = { n: 0 }
  const log = { write: (m: string) => void lines.push(m), close: () => void (closes.n += 1) }
  const proc = { on: (_e: 'exit', l: (code: number) => void) => void exits.push(l) }
  return { files, fs, lines, closes, log, proc, exits, advance: (ms: number) => void (t += ms), now: () => t }
}

afterEach(() => vi.useRealTimers())

describe('exit line', () => {
  it('writes one flushed line with the code, the uptime and the last command, whatever called process.exit', () => {
    const f = fakes()
    const w = watchExit({ ...f, dir: DIR, pid: 1908, heap: () => ({ used: 1, limit: 100 }) })
    return w.command('plans-merge', async () => undefined).then(() => {
      f.advance(125_000)
      f.exits[0](70)
      expect(f.lines).toEqual(['exit: code 70 after 125 s; last command: plans-merge'])
      expect(f.closes.n).toBe(1) // flushSync: the line is on disk before the process is gone
      w.dispose()
    })
  })

  it('names a command still running when the process exits', async () => {
    const f = fakes()
    const w = watchExit({ ...f, dir: DIR, heap: () => ({ used: 1, limit: 100 }) })
    void w.command('worker-start', () => new Promise(() => {}))
    f.advance(4_000)
    f.exits[0](0)
    expect(f.lines[0]).toBe('exit: code 0 after 4 s; last command: worker-start; still running: worker-start for 4 s')
    w.dispose()
  })

  it('says "none" for a Host that ran no command, and survives a log that throws', () => {
    const f = fakes()
    const w = watchExit({ ...f, log: { write: () => { throw new Error('disk') }, close: () => {} }, dir: DIR, heap: () => ({ used: 1, limit: 100 }) })
    expect(() => f.exits[0](1)).not.toThrow()
    w.dispose()
    const g = fakes()
    watchExit({ ...g, dir: DIR, heap: () => ({ used: 1, limit: 100 }) }).dispose()
    g.exits[0](0)
    expect(g.lines[0]).toContain('last command: none')
  })
})

describe('heap watch', () => {
  it('logs once at 80% and once at 95%, with used and limit, flushed', () => {
    vi.useFakeTimers()
    const f = fakes()
    const MB = 1024 * 1024
    let used = 700 * MB
    const w = watchExit({ ...f, dir: DIR, every: 1000, heap: () => ({ used, limit: 1000 * MB }) })
    vi.advanceTimersByTime(3000)
    expect(f.lines).toEqual([])
    used = 810 * MB
    vi.advanceTimersByTime(3000) // three ticks above 80%: still one line
    expect(f.lines).toEqual(['heap: 81% of the V8 limit (810 of 1000 MB, past 80%)'])
    used = 960 * MB
    vi.advanceTimersByTime(3000)
    expect(f.lines).toHaveLength(2)
    expect(f.lines[1]).toBe('heap: 96% of the V8 limit (960 of 1000 MB, past 95%)')
    expect(f.closes.n).toBe(2)
    w.dispose()
  })

  it('a jump past both thresholds is one line, and neither repeats', () => {
    vi.useFakeTimers()
    const f = fakes()
    let used = 99
    const w = watchExit({ ...f, dir: DIR, every: 1000, heap: () => ({ used, limit: 100 }) })
    vi.advanceTimersByTime(1000)
    used = 50
    vi.advanceTimersByTime(1000)
    used = 99
    vi.advanceTimersByTime(2000)
    expect(f.lines).toHaveLength(1)
    w.dispose()
  })

  it('does not keep the process alive', () => {
    const f = fakes()
    const unref = vi.spyOn(globalThis, 'setInterval')
    const w = watchExit({ ...f, dir: DIR, heap: () => ({ used: 1, limit: 100 }) })
    expect(unref).toHaveBeenCalled()
    const timer = unref.mock.results[0].value as NodeJS.Timeout
    expect(timer.hasRef()).toBe(false)
    w.dispose()
    unref.mockRestore()
  })
})

describe('heartbeat and the silent death', () => {
  const quiet = { heap: () => ({ used: 1, limit: 100 }) }
  const seen = (f: ReturnType<typeof fakes>): number => (JSON.parse(f.files.get(FILE)!) as { seen: number }).seen

  it('stamps seen every 3 s, on its own timer', () => {
    vi.useFakeTimers()
    const f = fakes()
    const w = watchExit({ ...f, dir: DIR, ...quiet, now: () => 1_000_000 + Date.now() })
    const first = seen(f)
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(seen(f)).toBe(first + HEARTBEAT_MS)
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(seen(f)).toBe(first + 2 * HEARTBEAT_MS)
    w.dispose()
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(seen(f)).toBe(first + 2 * HEARTBEAT_MS)
  })

  const dead = (f: ReturnType<typeof fakes>) => {
    const w = watchExit({ ...f, dir: DIR, pid: 55, ...quiet })
    void w.command('tasks-dispatch', () => new Promise(() => {}))
    w.dispose()
    return Array.from({ length: 50 }, (_, i) => `2026-11-01T00:00:${String(i).padStart(2, '0')}Z line ${i}`)
  }

  it('names a stale heartbeat with a dead pid, then quotes the last 20 log lines of 50', () => {
    const f = fakes()
    const log = dead(f)
    f.advance(30_000)
    const out = previousHostLines(DIR, { fs: f.fs, now: f.now, alive: () => false, tail: log.slice(-20) })
    expect(out[0]).toBe('the last Host (pid 55) died without a word (native crash?) after 0 s; last heartbeat 1970-01-01T00:16:40.000Z')
    expect(out[1]).toBe('the last Host died while running tasks-dispatch for 0 s')
    expect(out.slice(2)).toEqual(log.slice(30).map((l) => `  | ${l}`))
    expect(out).toHaveLength(22)
  })

  it('quotes a short log whole', () => {
    const f = fakes()
    const log = dead(f).slice(0, 5)
    f.advance(30_000)
    const out = previousHostLines(DIR, { fs: f.fs, now: f.now, alive: () => false, tail: log })
    expect(out.filter((l) => l.startsWith('  | '))).toHaveLength(5)
  })

  it('logs no death for a fresh heartbeat or a live pid', () => {
    const f = fakes()
    dead(f)
    f.advance(2 * HEARTBEAT_MS)
    expect(previousHostLines(DIR, { fs: f.fs, now: f.now, alive: () => false, tail: ['x'] }).join(' ')).not.toContain('without a word')
    f.advance(60_000)
    expect(previousHostLines(DIR, { fs: f.fs, now: f.now, alive: () => true, tail: ['x'] })).toEqual([])
  })

  it('keeps the exit wording for a record with an exit code, however old', () => {
    const f = fakes()
    const w = watchExit({ ...f, dir: DIR, pid: 7, ...quiet })
    f.exits[0](3)
    w.dispose()
    f.advance(60_000)
    expect(previousHostLines(DIR, { fs: f.fs, now: f.now, alive: () => false, tail: ['x'] })).toEqual(['the last Host (pid 7) exited with code 3 after 0 s'])
  })

  it('reads only the last 20 lines from the tail of a real file, and nothing from a missing one', () => {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tail-'))
    const file = path.join(dir, 'host.log')
    fsSync.writeFileSync(file, Array.from({ length: 5000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join(String.fromCharCode(10)) + String.fromCharCode(10))
    const t = readLogTail(file)
    expect(t).toHaveLength(20)
    expect(t[19]).toContain('line 4999')
    expect(t[0]).toContain('line 4980')
    expect(readLogTail(path.join(dir, 'nope.log'))).toEqual([])
    fsSync.rmSync(dir, { recursive: true })
  })
})

describe('the breadcrumb and the next Host', () => {
  it('holds the running command (name and start only) while it runs and clears it when it ends', async () => {
    const f = fakes()
    const w = watchExit({ ...f, dir: DIR, heap: () => ({ used: 1, limit: 100 }) })
    let release!: () => void
    const done = w.command('sessions-send', () => new Promise<void>((r) => (release = r)))
    const during = JSON.parse(f.files.get(FILE)!) as { running: Array<{ cmd: string; at: number }> }
    expect(during.running).toEqual([{ cmd: 'sessions-send', at: 1_000_000 }])
    release()
    await done
    expect((JSON.parse(f.files.get(FILE)!) as { running: unknown[] }).running).toEqual([])
    w.dispose()
  })

  it('clears it when the command throws, and passes the throw on', async () => {
    const f = fakes()
    const w = watchExit({ ...f, dir: DIR, heap: () => ({ used: 1, limit: 100 }) })
    await expect(w.command('x', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect((JSON.parse(f.files.get(FILE)!) as { running: unknown[] }).running).toEqual([])
    w.dispose()
  })

  it('tells the next Host what the dead one was doing and for how long, when no exit was recorded', () => {
    vi.useFakeTimers()
    const f = fakes()
    const w = watchExit({ ...f, dir: DIR, pid: 1908, every: 10_000, heap: () => ({ used: 1, limit: 100 }) })
    void w.command('tasks-dispatch', () => new Promise(() => {}))
    f.advance(42_000)
    vi.advanceTimersByTime(10_000) // the timer stamps the record; then the process is killed: no exit event
    const lines = previousHostLines(DIR, { fs: f.fs, now: f.now, alive: () => false })
    expect(lines).toEqual([
      'the last Host (pid 1908) left no exit record: killed from outside or a native crash after 42 s',
      'the last Host died while running tasks-dispatch for 42 s'
    ])
  })

  it('reports a recorded exit with its code and last command', async () => {
    const f = fakes()
    const w = watchExit({ ...f, dir: DIR, pid: 7, heap: () => ({ used: 1, limit: 100 }) })
    await w.command('host-retire', async () => undefined)
    f.advance(9_000)
    f.exits[0](0)
    expect(previousHostLines(DIR, { fs: f.fs })).toEqual(['the last Host (pid 7) exited with code 0 after 9 s; its last command was host-retire'])
  })

  it('says nothing for a profile with no record, and does not trust a record it cannot read', () => {
    const f = fakes()
    expect(previousHostLines(DIR, { fs: f.fs })).toEqual([])
    f.files.set(FILE, '{"pid": 1, "startedAt"')
    expect(previousHostLines(DIR, { fs: f.fs })).toEqual(['the last Host left no readable exit record: killed from outside or a native crash'])
  })

  it('never throws when the record cannot be written', async () => {
    const f = fakes()
    const fs: ExitFs = { ...f.fs, writeFileSync: () => { throw new Error('EACCES') } }
    const w = watchExit({ ...f, fs, dir: DIR, heap: () => ({ used: 1, limit: 100 }) })
    await expect(w.command('x', async () => 5)).resolves.toBe(5)
    w.dispose()
  })
})
