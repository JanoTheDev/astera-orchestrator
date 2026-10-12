// The controls of Settings › Remote Runtimes › This computer reach main: each `remote.*` the renderer calls is handled
// by thisMachineControl in ipc.ts and exposed by the preload. Both import electron, so their sources are read.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (p: string): string => readFileSync(path.join(process.cwd(), p), 'utf8')

describe('This computer controls wiring', () => {
  it('handles and exposes start, stop, pair, revoke and addresses', () => {
    const ipc = read('src/main/ipc.ts')
    const preload = read('src/preload/index.ts')
    for (const [name, call] of [['addresses', 'addresses()'], ['start', 'start(listen)'], ['stop', 'stop()'], ['pair', 'pair(o)'], ['revoke', 'revoke(id)']]) {
      expect(ipc, name).toContain(`ipcMain.handle('remote.${name}', `)
      expect(ipc, name).toContain(`thisMachine.${call}`)
      expect(preload, name).toContain(`${name}: invoke('remote.${name}')`)
    }
  })
})
