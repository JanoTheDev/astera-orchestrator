// The Devices view's facts, apart from the components so each is tested as data: a paired device's state, what the
// activity badge counts, the found devices still to add, the user@host a found one is offered as, and the command a
// terminal runs when the app cannot finish an add itself (sudo needs a password, the SSH key is not on the machine).
import type { AddMachineResult, FoundDevice, RemoteRuntimeInfo } from '../../../../core/types'

/** A device's accounts as its `accounts-list` answers (core/accounts/accountsFile.ts orchAccountsFor). */
export type DeviceAccount = { id: string; label: string; provider: string; signedIn?: boolean }
/** null: the device could not be asked; absent: not asked yet. */
export type AccountsOf = Record<string, DeviceAccount[] | null>

export type DeviceState = 'online' | 'offline' | 'unknown'

/** Plain names for the platform a Runtime's ping or beacon reports; any other is shown as it came. */
const OS_NAME: Record<string, string> = { linux: 'Linux', win32: 'Windows', windows: 'Windows', darwin: 'macOS' }
export const osName = (os: string | undefined): string => (os ? (OS_NAME[os.toLowerCase()] ?? os) : '')

/** `offline` is null until this app has asked the device anything since it started. */
export function deviceState(r: Pick<RemoteRuntimeInfo, 'offline'>): DeviceState {
  return r.offline === null ? 'unknown' : r.offline ? 'offline' : 'online'
}

/** A device that needs you: it does not answer, or one of its accounts is not signed in. */
export function needsAttention(r: Pick<RemoteRuntimeInfo, 'offline'>, accounts: DeviceAccount[] | null | undefined): boolean {
  return r.offline === true || (accounts ?? []).some((a) => a.signedIn === false)
}

/** The Devices activity badge: the paired devices that need you. */
export function devicesBadge(list: readonly RemoteRuntimeInfo[], accountsOf: AccountsOf): number {
  return list.filter((r) => needsAttention(r, accountsOf[r.runtimeId])).length
}

/** Found on your network: the found devices not paired here (a paired one is already under Your devices). */
export const foundNotPaired = (found: readonly FoundDevice[]): FoundDevice[] => found.filter((f) => !f.paired)

/** Where a found device came from, by its product names (not translated). */
export const sourceLabel = (f: Pick<FoundDevice, 'sources'>): string => f.sources.map((s) => (s === 'lan' ? 'LAN' : 'Tailscale')).join(' · ')

/** The user@host a found device is offered as: this computer's user name (its home folder's name) at its address. */
export function suggestedTarget(f: Pick<FoundDevice, 'address'>, homeDir: string | null | undefined): string {
  const user = homeDir?.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return user ? `${user}@${f.address}` : f.address
}

/** One word for a POSIX shell: kept bare when it is plain, else single-quoted with its quotes escaped. */
export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

export type TerminalFix = { kind: 'sudo' | 'sshKey'; command: string }

/** What a failed add leaves to a terminal, from the CLI's own fix text (cli/machines.ts connectFix and the install
 *  step): the SSH key copied with ssh-copy-id, or the whole add run where sudo can ask for its password. */
export function terminalFixOf(
  r: AddMachineResult | null,
  o: { target: string; port?: number; installer?: string; name?: string; fullControl: boolean }
): TerminalFix | null {
  if (!r || r.ok) return null
  const target = shellQuote(o.target.trim())
  const port = o.port ?? 22
  if (r.step === 'connect' && r.fix.includes('ssh-copy-id')) return { kind: 'sshKey', command: `ssh-copy-id -p ${port} ${target}` }
  if (r.step === 'install' && /needs sudo/i.test(r.fix)) {
    const args = ['astera', 'machines', 'add', target]
    if (port !== 22) args.push('--port', String(port))
    if (o.installer) args.push('--installer', shellQuote(o.installer))
    if (o.name?.trim()) args.push('--name', shellQuote(o.name.trim()))
    if (o.fullControl) args.push('--full-control')
    return { kind: 'sudo', command: args.join(' ') }
  }
  return null
}

/** Whether this computer takes work from other devices: its Gateway is not disabled. Unasked (undefined) or unknown
 *  (null: the Host cannot say) reads as no. */
export const acceptsWork = (mine: { gateway: { state: string } } | null | undefined): boolean => !!mine && mine.gateway.state !== 'disabled'

export type DeviceAction = 'open' | 'check' | 'retry' | 'forget'
/** A paired device's menu, in order: Open, then Check connection (Retry while it does not answer), then Forget. */
export const deviceActions = (state: DeviceState): DeviceAction[] => ['open', state === 'offline' ? 'retry' : 'check', 'forget']

export type FoundAction = 'add' | 'copyAddress'
/** A found device's menu. Ignore has no backend, so it is not offered. */
export const FOUND_ACTIONS: readonly FoundAction[] = ['add', 'copyAddress']
