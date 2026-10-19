// T23 "Start Astera at login": the Host starts when the person logs in, so a plan a crash interrupted picks up
// before any app window opens (core/orchestration/exec/crashResume.ts does the picking up, at the Host's start).
//
// Linux only: a systemd --user unit, and the XDG autostart file when there is no systemd user manager to enable it
// with. The entry runs `astera host start`, which starts this profile's Host detached and returns; a Host that is
// already up answers and nothing more happens.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

/** One entry per profile, so a second profile (`astera-dev`) never replaces the first one's. */
export const autostartNameOf = (profileDir: string): string => {
  const base = path.basename(profileDir.replace(/[\\/]+$/, ''))
  return base === 'astera' ? 'astera-host' : `astera-host-${base.replace(/[^A-Za-z0-9_.-]/g, '_')}`
}

/** A systemd quoted word: `"` and `\` escaped, `%` doubled (a specifier otherwise). */
const sdQuote = (s: string): string => `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/%/g, '%%')}"`
/** A desktop-entry Exec argument: quoted, `"`, `` ` ``, `$` and `\` escaped (Desktop Entry spec, "Exec key"). */
const xdgQuote = (s: string): string => `"${s.replace(/["`$\\]/g, (c) => `\\${c}`)}"`

export function systemdUnitText(a: { cli: string; profileDir: string }): string {
  return [
    '[Unit]',
    'Description=Astera Host: resumes running plans after login or a crash',
    '',
    '[Service]',
    // `host start` spawns the Host detached and exits; the Host stays in this unit's cgroup until it leaves.
    'Type=oneshot',
    'RemainAfterExit=yes',
    `Environment=${sdQuote(`ASTERA_PROFILE_DIR=${a.profileDir}`)}`,
    `ExecStart=${sdQuote(a.cli)} host start --no-keepalive`,
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n')
}

export function desktopEntryText(a: { cli: string; profileDir: string }): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Astera Host',
    'Comment=Resumes running plans after login or a crash',
    `Exec=env ${xdgQuote(`ASTERA_PROFILE_DIR=${a.profileDir}`)} ${xdgQuote(a.cli)} host start --no-keepalive`,
    'NoDisplay=true',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

export interface AutostartDeps {
  platform: NodeJS.Platform
  /** The XDG config folder: `$XDG_CONFIG_HOME`, else `~/.config`. */
  configHome: string
  /** `systemctl --user <args>`: true when it exited 0. */
  systemctl(args: string[]): Promise<boolean>
}

export type AutostartResult = 'systemd' | 'xdg' | 'off' | 'unsupported'

/** Writes (enabled) or removes (disabled) this profile's login entry. Never throws: a login entry that could not be
 *  written costs the autostart, never the app's start. */
export async function applyAutostart(
  a: { enabled: boolean; cli: string; profileDir: string; log(m: string): void },
  d: AutostartDeps
): Promise<AutostartResult> {
  if (d.platform !== 'linux') return 'unsupported'
  const name = autostartNameOf(a.profileDir)
  const unitFile = path.join(d.configHome, 'systemd', 'user', `${name}.service`)
  const desktopFile = path.join(d.configHome, 'autostart', `${name}.desktop`)
  try {
    if (!a.enabled) {
      await d.systemctl(['disable', `${name}.service`]).catch(() => false)
      await fs.rm(unitFile, { force: true })
      await fs.rm(desktopFile, { force: true })
      await d.systemctl(['daemon-reload']).catch(() => false)
      return 'off'
    }
    await writeIfChanged(unitFile, systemdUnitText(a))
    if ((await d.systemctl(['daemon-reload']).catch(() => false)) && (await d.systemctl(['enable', `${name}.service`]).catch(() => false))) {
      // Only one entry: both would start the Host twice at login (the second finds it up, but says so in the log).
      await fs.rm(desktopFile, { force: true })
      return 'systemd'
    }
    await fs.rm(unitFile, { force: true })
    await writeIfChanged(desktopFile, desktopEntryText(a))
    return 'xdg'
  } catch (err) {
    a.log(`autostart: the login entry could not be ${a.enabled ? 'written' : 'removed'}: ${String(err)}`)
    return 'off'
  }
}

async function writeIfChanged(file: string, text: string): Promise<void> {
  const was = await fs.readFile(file, 'utf8').catch(() => null)
  if (was === text) return
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text, 'utf8')
}

/** The real deps: this process's platform and environment, `systemctl` on the PATH. */
export function realAutostartDeps(env: NodeJS.ProcessEnv, home: string): AutostartDeps {
  return {
    platform: process.platform,
    configHome: env.XDG_CONFIG_HOME || path.join(home, '.config'),
    systemctl: (args) =>
      new Promise((resolve) => execFile('systemctl', ['--user', ...args], { timeout: 10_000 }, (err) => resolve(!err)))
  }
}
