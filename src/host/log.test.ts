import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openHostLog, logUncaughtExceptions, logUnhandledRejections } from './log'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-host-log-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('openHostLog', () => {
  it('creates the file and its directory, and stamps every line', () => {
    const p = path.join(dir, 'nested', 'host.log')
    const log = openHostLog({ path: p })
    log.write('started')
    log.close()
    const text = readFileSync(p, 'utf8')
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z started\n$/)
  })

  it('appends across opens rather than starting over', () => {
    const p = path.join(dir, 'host.log')
    const a = openHostLog({ path: p })
    a.write('first')
    a.close()
    const b = openHostLog({ path: p })
    b.write('second')
    b.close()
    expect(readFileSync(p, 'utf8').split('\n').filter(Boolean)).toHaveLength(2)
  })

  // A Host that runs for weeks must not fill the disk with its own diary. Past the cap the file is
  // rotated to host.log.1 (stage 3, task 3), so two files at most, each within the cap.
  it('rotates the file once it passes the cap, keeping one old file', () => {
    const p = path.join(dir, 'host.log')
    const log = openHostLog({ path: p, maxBytes: 200 })
    for (let i = 0; i < 20; i++) {
      log.write(`line ${i} ${'x'.repeat(20)}`)
      log.close()
    }
    const text = readFileSync(p, 'utf8')
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text).toContain('line 19')
    expect(readFileSync(p + '.1', 'utf8').length).toBeLessThanOrEqual(200)
    expect(readdirSync(dir).sort()).toEqual(['host.log', 'host.log.1'])
  })

  it('touches no file on a write: lines are on disk once flushed', () => {
    const p = path.join(dir, 'lazy.log')
    const log = openHostLog({ path: p })
    log.write('buffered')
    expect(existsSync(p)).toBe(false)
    log.close()
    expect(readFileSync(p, 'utf8')).toMatch(/ buffered\n$/)
  })

  // The Host must not die because its log could not be written. A regular file where a directory has
  // to go is a failure mkdir cannot work around; a path whose parents merely do not exist is not,
  // because `recursive: true` would create them and nothing would fail.
  it('swallows a write when the log path cannot be opened', () => {
    const blocker = path.join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    const log = openHostLog({ path: path.join(blocker, 'nested', 'host.log') })
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(() => log.write('still fine')).not.toThrow()
    expect(() => log.close()).not.toThrow()
    err.mockRestore()
  })
})

// Final review C1, the belt: a rejection nobody handled is logged and the Host keeps running. Node 24's
// default mode throws it, which ends node.exe and every session in it. The fix is that every Slack start
// ends in a catch; this only keeps a miss somewhere else from being fatal.
describe('logUnhandledRejections', () => {
  it('logs a rejection nobody handled by its error name only, and keeps the process running', async () => {
    const lines: string[] = []
    const off = logUnhandledRejections(process, { write: (m) => lines.push(m), close: () => {} })
    try {
      void Promise.reject(Object.assign(new Error('invalid_auth xapp-secret'), { name: 'WebAPIPlatformError' }))
      await new Promise((r) => setTimeout(r, 20))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/unhandled rejection \(WebAPIPlatformError\), kept running/)
      expect(lines[0]).not.toMatch(/xapp-secret/)
    } finally {
      off()
    }
  })

  it('never throws, even when the log does', () => {
    const listeners: Array<(r: unknown) => void> = []
    const off = logUnhandledRejections({ on: (_e: string, l: (r: unknown) => void) => listeners.push(l), off: () => {} }, {
      write: () => {
        throw new Error('disk full')
      },
      close: () => {}
    })
    expect(() => listeners[0]('not an error')).not.toThrow()
    off()
  })
})

// 2026-10-12: a Host died with every session and left no line, because an exception nobody caught ends node.exe with
// its stack on a stderr nobody reads. The Host says what ended it (the error's name and the frame it was thrown at,
// never the message, which can carry a token) and then exits, since a process past an uncaught exception is not safe
// to keep.
describe('logUncaughtExceptions', () => {
  const thrown = Object.assign(new Error('invalid_auth xoxb-secret'), {
    name: 'TypeError',
    stack: 'TypeError: invalid_auth xoxb-secret\n    at launch (D:\\app\\host.js:120:7)\n    at run (D:\\app\\host.js:80:3)'
  })

  it('logs the name and the frames it was thrown at, not the message, and exits with the code it is given', () => {
    const lines: string[] = []
    const codes: number[] = []
    let listener: (e: unknown) => void = () => {}
    logUncaughtExceptions({ on: (_e: string, l: (e: unknown) => void) => void (listener = l) }, { write: (m) => lines.push(m), close: () => {} }, { code: 70, exit: (c) => codes.push(c) })
    listener(thrown)
    expect(lines).toEqual(['fatal: uncaught exception (TypeError) at launch (D:\\app\\host.js:120:7) < at run (D:\\app\\host.js:80:3); exiting'])
    expect(lines.join('')).not.toContain('xoxb')
    expect(codes).toEqual([70])
  })

  // Final review M6: a frame inside Node or an anonymous one says nothing about where in the Host it went wrong.
  it("skips Node's own frames and keeps at most three of the Host's", () => {
    const lines: string[] = []
    let listener: (e: unknown) => void = () => {}
    logUncaughtExceptions({ on: (_e: string, l: (e: unknown) => void) => void (listener = l) }, { write: (m) => lines.push(m), close: () => {} }, { code: 70, exit: () => {} })
    listener(Object.assign(new Error('x'), {
      name: 'SyntaxError',
      stack: 'SyntaxError: x\n    at JSON.parse (<anonymous>)\n    at node:internal/foo:1:1\n    at a (D:\\h.js:1:1)\n    at b (D:\\h.js:2:1)\n    at c (D:\\h.js:3:1)\n    at d (D:\\h.js:4:1)'
    }))
    expect(lines).toEqual(['fatal: uncaught exception (SyntaxError) at a (D:\\h.js:1:1) < at b (D:\\h.js:2:1) < at c (D:\\h.js:3:1); exiting'])
  })

  it('still exits when the log throws, and says something for a thrown value with no stack', () => {
    const codes: number[] = []
    let listener: (e: unknown) => void = () => {}
    logUncaughtExceptions({ on: (_e: string, l: (e: unknown) => void) => void (listener = l) }, { write: () => { throw new Error('disk full') }, close: () => {} }, { code: 70, exit: (c) => codes.push(c) })
    listener(thrown)
    const lines: string[] = []
    logUncaughtExceptions({ on: (_e: string, l: (e: unknown) => void) => void (listener = l) }, { write: (m) => lines.push(m), close: () => {} }, { code: 70, exit: (c) => codes.push(c) })
    listener('a string')
    expect(codes).toEqual([70, 70])
    expect(lines).toEqual(['fatal: uncaught exception (string); exiting'])
  })
})

describe('the Host installs its last word', () => {
  it('beside the rejection belt, at start', () => {
    const index = readFileSync(path.join(process.cwd(), 'src', 'host', 'index.ts'), 'utf8')
    expect(index).toMatch(/logUnhandledRejections\(process, log\)[\s\S]{0,200}logUncaughtExceptions\(process, log, \{ code: HOST_EXIT\.uncaught/)
  })
})
