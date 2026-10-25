import { describe, expect, it } from 'vitest'
import type { AddMachineResult, FoundDevice, RemoteRuntimeInfo } from '../../../../core/types'
import { acceptsWork, deviceActions, FOUND_ACTIONS, deviceState, devicesBadge, foundNotPaired, needsAttention, osName, shellQuote, sourceLabel, suggestedTarget, terminalFixOf } from './devicesView'

const rt = (runtimeId: string, offline: boolean | null): RemoteRuntimeInfo => ({
  runtimeId, name: runtimeId, address: '10.0.0.2', port: 47831, permission: 'full-control', lastSeenAt: null, offline
})
const found = (key: string, paired?: string): FoundDevice => ({ key, name: key, address: '192.168.1.9', os: 'linux', sources: ['lan'], ...(paired ? { paired } : {}) })
const failed = (step: 'connect' | 'install', fix: string): AddMachineResult => ({ ok: false, step, message: 'x', stderrTail: '', fix })

describe('devices view', () => {
  it('a device is online, offline, or not asked yet', () => {
    expect(deviceState(rt('a', false))).toBe('online')
    expect(deviceState(rt('a', true))).toBe('offline')
    expect(deviceState(rt('a', null))).toBe('unknown')
  })

  it('the badge counts devices that are offline or have an account to sign in', () => {
    const accounts = { b: [{ id: '1', label: 'me', provider: 'claude', signedIn: false }], c: [{ id: '2', label: 'me', provider: 'codex', signedIn: true }], d: null }
    expect(needsAttention(rt('a', true), undefined)).toBe(true)
    expect(needsAttention(rt('b', false), accounts.b)).toBe(true)
    expect(needsAttention(rt('c', false), accounts.c)).toBe(false)
    expect(devicesBadge([rt('a', true), rt('b', false), rt('c', false), rt('d', null)], accounts)).toBe(2)
  })

  it('found devices already paired stay under Your devices', () => {
    expect(foundNotPaired([found('x'), found('y', 'rt-1')]).map((f) => f.key)).toEqual(['x'])
    expect(sourceLabel({ sources: ['lan', 'tailscale'] })).toBe('LAN · Tailscale')
  })

  it('a found device is offered as this user at its address', () => {
    expect(suggestedTarget({ address: '192.168.1.9' }, '/home/jon')).toBe('jon@192.168.1.9')
    expect(suggestedTarget({ address: '100.64.0.3' }, 'C:\\Users\\Jon\\')).toBe('Jon@100.64.0.3')
    expect(suggestedTarget({ address: '192.168.1.9' }, null)).toBe('192.168.1.9')
    expect(osName('win32')).toBe('Windows')
    expect(osName('plan9')).toBe('plan9')
  })
})

describe('Run in a terminal', () => {
  it('a missing SSH key gives ssh-copy-id with the port', () => {
    const fix = 'Put your public key on the machine (ssh-copy-id -p 2222 jon@box) and try again. Astera never asks for a password.'
    expect(terminalFixOf(failed('connect', fix), { target: ' jon@box ', port: 2222, fullControl: true })).toEqual({ kind: 'sshKey', command: 'ssh-copy-id -p 2222 jon@box' })
    expect(terminalFixOf(failed('connect', 'Put your public key on the machine (ssh-copy-id -p 22 jon@box)'), { target: 'jon@box', fullControl: false })?.command).toBe('ssh-copy-id -p 22 jon@box')
  })

  it('sudo needing a password gives the whole add, its options quoted', () => {
    const fix = 'It needs sudo. Run `astera machines add jon@box` in a terminal so sudo can ask for the password there, or allow this user sudo without a password.'
    expect(terminalFixOf(failed('install', fix), { target: 'jon@box', fullControl: true })).toEqual({ kind: 'sudo', command: 'astera machines add jon@box --full-control' })
    expect(terminalFixOf(failed('install', fix), { target: 'jon@box', port: 2200, installer: "/home/jon/My Builds/astera-1.0.0-amd64.deb", name: "Jon's box", fullControl: false })?.command).toBe(
      "astera machines add jon@box --port 2200 --installer '/home/jon/My Builds/astera-1.0.0-amd64.deb' --name 'Jon'\\''s box'"
    )
  })

  it('other failures and successes have no terminal command', () => {
    expect(terminalFixOf(failed('connect', 'Check the address, that the machine is on'), { target: 'jon@box', fullControl: true })).toBeNull()
    expect(terminalFixOf(failed('install', 'Read the lines above; you can run it by hand'), { target: 'jon@box', fullControl: true })).toBeNull()
    expect(terminalFixOf({ ok: true, runtimeId: 'r', name: 'box', os: 'linux', repaired: false }, { target: 'jon@box', fullControl: true })).toBeNull()
    expect(terminalFixOf(null, { target: 'jon@box', fullControl: true })).toBeNull()
  })

  it('quotes anything a shell would split or expand', () => {
    expect(shellQuote('jon@box.local')).toBe('jon@box.local')
    expect(shellQuote('a b')).toBe("'a b'")
    expect(shellQuote('$(rm -rf ~)')).toBe("'$(rm -rf ~)'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })

  it('a device menu opens it, checks it (Retry while offline) and forgets it', () => {
    expect(deviceActions('online')).toEqual(['open', 'check', 'forget'])
    expect(deviceActions('unknown')).toEqual(['open', 'check', 'forget'])
    expect(deviceActions('offline')).toEqual(['open', 'retry', 'forget'])
    expect(FOUND_ACTIONS).toEqual(['add', 'copyAddress'])
  })

  it('this computer accepts work unless its Gateway is disabled or the Host cannot say', () => {
    expect(acceptsWork({ gateway: { state: 'listening' } })).toBe(true)
    expect(acceptsWork({ gateway: { state: 'disabled' } })).toBe(false)
    expect(acceptsWork(null)).toBe(false)
    expect(acceptsWork(undefined)).toBe(false)
  })
})
