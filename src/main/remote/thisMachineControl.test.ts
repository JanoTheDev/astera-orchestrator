// Settings › Remote Runtimes › This computer runs the CLI's own runtime commands (cli/runtime/commands.ts) in main:
// the same checks, the same Host commands, the same answers, so the app and `astera runtime ...` cannot disagree.
import { describe, it, expect } from 'vitest'
import type { NetworkInterfaceInfo } from 'node:os'
import { createThisMachineControl, type ThisMachineDeps } from './thisMachineControl'
import { REMOTE_DEFAULTS, type RemoteSettings } from '../../core/remote/settings'

const nic = (address: string): NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null }) as NetworkInterfaceInfo

const rig = (o: { hostDown?: boolean } = {}) => {
  let settings: RemoteSettings = { ...REMOTE_DEFAULTS }
  const calls: Array<[string, Record<string, unknown>]> = []
  const identity = { runtimeId: 'rt_1', spkiSha256: 'sha256:abc', displayName: 'office' }
  const deps: ThisMachineDeps = {
    readSettings: async () => settings,
    writeSettings: async (p) => (settings = { ...settings, ...p }),
    ensureIdentity: async () => identity,
    loadIdentity: async () => identity,
    call: async (cmd, args) => {
      calls.push([cmd, args])
      if (o.hostDown) throw new Error('no connection to the Host')
      if (cmd === 'runtime-reload' || cmd === 'runtime-status')
        return { status: 200, body: { gateway: settings.enabled ? { state: 'ready', listen: settings.listen, port: settings.port } : { state: 'disabled' } } }
      if (cmd === 'pair-create') return { status: 200, body: { code: 'K7Q2-9XPA', expiresAt: '2026-10-12T05:10:00.000Z' } }
      if (cmd === 'clients-revoke') return { status: 200, body: { revoked: true } }
      return { status: 400, body: { error: `unexpected ${cmd}` } }
    },
    interfaces: () => ({ 'Wi-Fi': [nic('192.168.0.235')] }),
    hostname: () => 'office',
    sleep: async () => {}
  }
  return { control: createThisMachineControl(deps), calls, settings: () => settings }
}

describe('createThisMachineControl', () => {
  it('offers the private addresses and this computer, never every interface', () => {
    expect(rig().control.addresses().map((c) => c.address)).toEqual(['192.168.0.235', '127.0.0.1'])
  })

  it('turns Remote on on an offered address, and off', async () => {
    const h = rig()
    expect(await h.control.start('192.168.0.235')).toMatchObject({ ok: true, body: { enabled: true, listen: '192.168.0.235', fingerprint: 'sha256:abc' } })
    expect(h.settings()).toMatchObject({ enabled: true, listen: '192.168.0.235' })
    expect(await h.control.stop()).toMatchObject({ ok: true, body: { enabled: false } })
    expect(h.settings().enabled).toBe(false)
  })

  // Nothing the renderer sends is trusted: an address this machine does not offer is refused before anything is written.
  it('refuses an address that is not offered, every interface included', async () => {
    for (const listen of ['0.0.0.0', '::', '203.0.113.9', 42, undefined]) {
      const h = rig()
      expect(await h.control.start(listen), String(listen)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' })
      expect(h.settings().enabled).toBe(false)
      expect(h.calls).toEqual([])
    }
  })

  it('makes a pairing string, read-only unless full control is asked, with the name', async () => {
    const h = rig()
    await h.control.start('192.168.0.235')
    const ro = await h.control.pair({ name: 'macbook' })
    expect(ro).toMatchObject({ ok: true, body: { permission: 'read-only', pairing: 'astera-pair:v1:192.168.0.235:47831:K7Q2-9XPA:sha256:abc', expiresAt: '2026-10-12T05:10:00.000Z' } })
    expect(h.calls.at(-1)).toEqual(['pair-create', { permission: 'read-only', name: 'macbook' }])
    expect(await h.control.pair({ fullControl: true })).toMatchObject({ ok: true, body: { permission: 'full-control' } })
  })

  it('refuses a pairing while Remote is off, as the CLI does', async () => {
    expect(await rig().control.pair({})).toMatchObject({ ok: false, code: 'CONFLICT' })
  })

  it('refuses a malformed pairing request', async () => {
    const h = rig()
    await h.control.start('192.168.0.235')
    for (const bad of [null, 'x', { fullControl: 'yes' }, { name: 7 }, { name: 'x'.repeat(65) }])
      expect(await h.control.pair(bad), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' })
  })

  it('revokes a controller by its id', async () => {
    const h = rig()
    expect(await h.control.revoke('cli_1')).toMatchObject({ ok: true })
    expect(h.calls.at(-1)).toEqual(['clients-revoke', { id: 'cli_1' }])
    expect(await h.control.revoke('')).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' })
  })

  it('says the Host is not running when it cannot be reached', async () => {
    const h = rig({ hostDown: true })
    expect(await h.control.start('192.168.0.235')).toMatchObject({ ok: false, code: 'HOST_NOT_RUNNING' })
    expect(await h.control.revoke('cli_1')).toMatchObject({ ok: false, code: 'HOST_NOT_RUNNING' })
  })

  // Final review I1: a start that reached no Host said it failed but left Remote on in the settings, so the next Host
  // start (the app reconnecting) opened this machine on that address while the person believed it off. The settings
  // go back to what they were.
  it('leaves Remote as it was when no Host took the start', async () => {
    const h = rig({ hostDown: true })
    const before = { ...h.settings() }
    expect(await h.control.start('192.168.0.235')).toMatchObject({ ok: false, code: 'HOST_NOT_RUNNING' })
    expect(h.settings()).toEqual(before)
  })

  // Review focus 5: two clicks do not run two starts side by side.
  it('runs one command at a time', async () => {
    const h = rig()
    const order: string[] = []
    const a = h.control.start('192.168.0.235').then(() => order.push('start'))
    const b = h.control.pair({}).then((r) => order.push(r.ok ? 'pair ok' : 'pair refused'))
    await Promise.all([a, b])
    expect(order).toEqual(['start', 'pair ok'])
  })
})
