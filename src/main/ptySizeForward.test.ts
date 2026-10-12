// A pty's size reaches its tab (terminal size follows the side that typed last): main hands every `pty-size` the Host
// sends with a session to the window as `session:pty-size`. The wiring lives in ipc.ts, which imports electron, so its
// source is read.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('pty-size forwarding', () => {
  it('sends the window each size the Host gives a session pty, with whether this machine owns it', () => {
    const ipc = readFileSync(path.join(__dirname, 'ipc.ts'), 'utf8')
    expect(ipc).toMatch(/m\.t === 'pty-size' && m\.session !== undefined\)\s*send\('session:pty-size', \{ sessionId: m\.session, cols: m\.cols, rows: m\.rows, owned: m\.owned \}\)/)
  })

  // Final review I4: only the tab's own input (the renderer's sessions.write) is marked typed; the app's other writes
  // (a schedule, a Slack reply, a roll's prompt) go through core.sessions.write without it.
  it("marks the tab's input typed, terminal reports excepted", () => {
    const ipc = readFileSync(path.join(__dirname, 'ipc.ts'), 'utf8')
    expect(ipc).toMatch(/ipcMain\.on\('sessions\.write', \(_e, id, data\) => \{[\s\S]{0,300}core\.sessions\.write\(id, data, typeof data === 'string' && !isOnlyTerminalReports\(data\) \? \{ typed: true \} : undefined\)/)
  })
})
