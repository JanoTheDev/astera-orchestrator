import { describe, it, expect } from 'vitest'
import { addressLabel, failureLine, pairedStateLine, pairingLeftLine, pairingStillShown, pingLine, thisMachineLine } from './remoteRuntimesText'

/** A t that shows the key and its params, so each assertion names the sentence it expects. */
const t = (key: string, params?: Record<string, unknown>): string => `${key}${params ? ` ${JSON.stringify(params)}` : ''}`

describe('Settings › Remote Runtimes text (remote runtime design Phase 6)', () => {
  it('this computer: unknown, off, or on with its address and Gateway state', () => {
    expect(thisMachineLine(null, t)).toBe('settings.remote.thisMachine.unknown')
    expect(thisMachineLine({ gateway: { state: 'disabled' }, clients: [] }, t)).toBe('settings.remote.thisMachine.off')
    expect(thisMachineLine({ gateway: { state: 'ready', listen: '100.64.0.5', port: 47831 }, clients: [] }, t)).toBe(
      'settings.remote.thisMachine.on {"listen":"100.64.0.5","port":47831,"state":"ready"}'
    )
  })
  it('a ping answers with the version and platform, or the code; never a token', () => {
    expect(pingLine({ ok: true, hello: { runtimeId: 'rt', displayName: 'Office', asteraVersion: '1.4.8', platform: 'linux', bootId: 'b' } }, t)).toBe(
      'settings.remote.paired.online {"version":"1.4.8","platform":"linux"}'
    )
    expect(pingLine({ ok: false, code: 'RUNTIME_OFFLINE', message: 'connect refused' }, t)).toBe('settings.remote.paired.offline {"code":"RUNTIME_OFFLINE"}')
  })
  it('a failure says its code and message', () => {
    expect(failureLine({ ok: false, code: 'RUNTIME_IDENTITY_CHANGED', message: 'a different key' }, t)).toBe(
      'settings.remote.failed {"code":"RUNTIME_IDENTITY_CHANGED","message":"a different key"}'
    )
  })
})

// Phase 6 review minor: the list says a paired Runtime did not answer the last time this app asked it.
describe('a paired Runtime state line', () => {
  it('says it did not answer only when the last call went unanswered', () => {
    expect(pairedStateLine({ offline: true }, t)).toBe('settings.remote.paired.notAnswering')
    expect(pairedStateLine({ offline: false }, t)).toBeNull()
    expect(pairedStateLine({ offline: null }, t)).toBeNull()
  })
})

// Settings › This computer's own controls (turning Remote on, a pairing string): an address is named with where it is,
// and a pairing string says how long it has left, and goes when it has none or Remote went off (review focus 2).
describe("this computer's controls text", () => {
  it('names an address by its interface, and 127.0.0.1 as this computer only', () => {
    expect(addressLabel({ address: '192.168.0.235', iface: 'Wi-Fi', local: false }, t)).toBe('settings.remote.start.iface {"address":"192.168.0.235","iface":"Wi-Fi"}')
    expect(addressLabel({ address: '127.0.0.1', iface: null, local: true }, t)).toBe('settings.remote.start.local {"address":"127.0.0.1"}')
  })

  it("says the time a pairing string has left, as minutes and seconds, and that it is spent once it is not", () => {
    const at = Date.parse('2026-10-12T05:10:00.000Z')
    expect(pairingLeftLine('2026-10-12T05:10:00.000Z', at - 581_000, t)).toBe('settings.remote.newPair.expires {"time":"9:41"}')
    expect(pairingLeftLine('2026-10-12T05:10:00.000Z', at - 5_000, t)).toBe('settings.remote.newPair.expires {"time":"0:05"}')
    expect(pairingLeftLine('2026-10-12T05:10:00.000Z', at, t)).toBe('settings.remote.newPair.expired')
    expect(pairingLeftLine('not a time', at, t)).toBe('settings.remote.newPair.expired')
  })

  it('keeps a pairing string on screen only while it is live and Remote is on', () => {
    const at = Date.parse('2026-10-12T05:10:00.000Z')
    const on = { gateway: { state: 'ready' }, clients: [] }
    expect(pairingStillShown({ expiresAt: '2026-10-12T05:10:00.000Z' }, on, at - 1_000)).toBe(true)
    expect(pairingStillShown({ expiresAt: '2026-10-12T05:10:00.000Z' }, on, at + 60_000)).toBe(false)
    expect(pairingStillShown({ expiresAt: '2026-10-12T05:10:00.000Z' }, { gateway: { state: 'disabled' }, clients: [] }, at - 1_000)).toBe(false)
    expect(pairingStillShown({ expiresAt: '2026-10-12T05:10:00.000Z' }, null, at - 1_000)).toBe(false)
  })
})
