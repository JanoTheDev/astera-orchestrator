// The app's side of the handshake is the package's connectHost (packages/client/src/connect.ts, tested there)
// with one thing added: an MCP client's name is cleaned the way the Host stores it (core/continuity/actor.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { connectHost } from './connect'
import { helloLine, listen, makeProfile } from '../../../packages/client/test/fakeHost.js'

let profile: Awaited<ReturnType<typeof makeProfile>>
beforeAll(async () => {
  profile = await makeProfile()
})
afterAll(async () => {
  await profile.cleanup()
})

describe('connectHost (app)', () => {
  it('carries the MCP client it was given in the hello, cleaned, and none when it was given none', async () => {
    const seen: unknown[] = []
    const host = await listen((sock, nonce, h) => {
      seen.push((h as { client?: unknown }).client)
      sock.write(helloLine(profile.key, nonce))
    })
    try {
      for (const client of [undefined, { name: 'claude-code', version: '1.2.3' }, { name: 'a\u0007b' }, { name: '\u0007' }]) {
        const conn = await connectHost({ address: host.address, profileDir: profile.dir, app: 'test', role: 'mcp', timeoutMs: 2000, log: () => {}, ...(client ? { client } : {}) })
        if ('error' in conn) throw new Error(conn.error)
        conn.close()
      }
    } finally {
      await host.close()
    }
    expect(seen).toEqual([undefined, { name: 'claude-code', version: '1.2.3' }, { name: 'ab' }, undefined])
  })
})
