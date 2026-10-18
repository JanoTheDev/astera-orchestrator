import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyAutostart, autostartNameOf, desktopEntryText, systemdUnitText } from './autostart'

const cli = '/home/u/.local/bin/astera'
const profileDir = '/home/u/.config/astera'

describe('login entry text', () => {
  it('the systemd unit starts this profile\'s Host at login', () => {
    const t = systemdUnitText({ cli, profileDir })
    expect(t).toContain('Environment="ASTERA_PROFILE_DIR=/home/u/.config/astera"')
    expect(t).toContain('ExecStart="/home/u/.local/bin/astera" host start --no-keepalive')
    expect(t).toContain('WantedBy=default.target')
    expect(t).toContain('RemainAfterExit=yes')
  })
  it('quotes paths with spaces and escapes % for systemd', () => {
    expect(systemdUnitText({ cli: '/a b/100%/astera', profileDir })).toContain('ExecStart="/a b/100%%/astera" host start')
  })
  it('the XDG autostart file runs the same command', () => {
    const t = desktopEntryText({ cli, profileDir })
    expect(t).toContain('Exec=env "ASTERA_PROFILE_DIR=/home/u/.config/astera" "/home/u/.local/bin/astera" host start --no-keepalive')
    expect(t).toContain('Type=Application')
  })
  it('names one entry per profile', () => {
    expect(autostartNameOf('/home/u/.config/astera')).toBe('astera-host')
    expect(autostartNameOf('/home/u/.config/astera-dev/')).toBe('astera-host-astera-dev')
  })
})

describe('applyAutostart', () => {
  let home: string
  const calls: string[][] = []
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'autostart-'))
    calls.length = 0
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true })
  })
  const deps = (systemd: boolean) => ({
    platform: 'linux' as const,
    configHome: home,
    systemctl: async (args: string[]) => {
      calls.push(args)
      return systemd
    }
  })
  const unit = () => path.join(home, 'systemd', 'user', 'astera-host.service')
  const desktop = () => path.join(home, 'autostart', 'astera-host.desktop')
  const exists = (p: string) => fs.access(p).then(() => true, () => false)

  it('on: writes and enables the systemd unit', async () => {
    expect(await applyAutostart({ enabled: true, cli, profileDir, log: () => {} }, deps(true))).toBe('systemd')
    expect(await fs.readFile(unit(), 'utf8')).toBe(systemdUnitText({ cli, profileDir }))
    expect(calls).toContainEqual(['enable', 'astera-host.service'])
    expect(await exists(desktop())).toBe(false)
  })
  it('on without a systemd user manager: the XDG autostart file instead', async () => {
    expect(await applyAutostart({ enabled: true, cli, profileDir, log: () => {} }, deps(false))).toBe('xdg')
    expect(await fs.readFile(desktop(), 'utf8')).toBe(desktopEntryText({ cli, profileDir }))
    expect(await exists(unit())).toBe(false)
  })
  it('the setting off removes both entries', async () => {
    await applyAutostart({ enabled: true, cli, profileDir, log: () => {} }, deps(false))
    await applyAutostart({ enabled: true, cli, profileDir, log: () => {} }, deps(true))
    expect(await applyAutostart({ enabled: false, cli, profileDir, log: () => {} }, deps(true))).toBe('off')
    expect(calls).toContainEqual(['disable', 'astera-host.service'])
    expect(await exists(unit())).toBe(false)
    expect(await exists(desktop())).toBe(false)
  })
  it('does nothing off Linux', async () => {
    expect(await applyAutostart({ enabled: true, cli, profileDir, log: () => {} }, { ...deps(true), platform: 'darwin' })).toBe('unsupported')
    expect(calls).toEqual([])
  })
})
