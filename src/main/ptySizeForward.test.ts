// A pty's size reaches its tab (terminal size follows the side that typed last): main hands every `pty-size` the Host
// sends with a session to the window as `session:pty-size`. The wiring lives in ipc.ts, which imports electron, so its
// source is read.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('pty-size forwarding', () => {
  it('sends the window each size the Host gives a session pty', () => {
    const ipc = readFileSync(path.join(__dirname, 'ipc.ts'), 'utf8')
    expect(ipc).toMatch(/m\.t === 'pty-size' && m\.session !== undefined\)\s*send\('session:pty-size', \{ sessionId: m\.session, cols: m\.cols, rows: m\.rows \}\)/)
  })
})
