// Where the Host listens. The rule itself (`hostAddress`) is the SDK package's (packages/client/src/address.ts),
// so the Host that binds and every client that connects derive one address; what stays here is the app's own
// business with addresses of other protocol versions.
import { PIPE_DIR, hostAddress, type HostAddress } from '../core/publicContract'

export { hostAddress, type HostAddress }

/**
 * Tells a Host at any older protocol's address to leave. Its terminals end with it — surviving an
 * update is not a promise this app makes, and the alternative is a Host the new app can neither show
 * nor stop (design §9).
 *
 * `connect` is injected: it writes one line to an address and reports whether anything was there.
 */
export async function retireOlderHosts(a: {
  profileDir: string
  platform: NodeJS.Platform
  tmpDir: string
  protocol: number
  connect(address: string, line: string): Promise<boolean>
  log(m: string): void
}): Promise<number> {
  let retired = 0
  for (let v = 1; v < a.protocol; v++) {
    const { address } = hostAddress({ profileDir: a.profileDir, platform: a.platform, tmpDir: a.tmpDir, protocol: v })
    const answered = await a.connect(address, `${JSON.stringify({ t: 'retire' })}\n`)
    if (!answered) continue
    a.log(`a Host speaking protocol ${v} was asked to leave; its terminals end with it`)
    retired += 1
  }
  return retired
}

/**
 * The addresses of this profile's Hosts at **other** protocol versions that exist right now, with
 * the protocol each one names. `list` reads a directory's entry names.
 *
 * **Why a CLI needs this** (conformance audit #12). The protocol is part of the address (above), so
 * a CLI of another build asks its own address, finds nobody, and would read the state file a live
 * Host is writing. Before it trusts "nobody is there" it asks whether a sibling is.
 *
 * **Listed rather than enumerated**, so a newer protocol than this build knows is found too. On
 * win32 the pipe namespace is listable and a pipe is there only while a server holds it. On posix
 * the entries are the per-address directories under the temp folder, and a directory can outlive
 * its Host, so an entry found here is a candidate: the caller still has to connect to it. A listing
 * that cannot be read finds nothing, which is the answer this path gave before the check existed.
 */
export function siblingHostAddresses(a: {
  profileDir: string
  platform: NodeJS.Platform
  tmpDir: string
  protocol: number
  list(dir: string): readonly string[]
}): { protocol: number; address: string }[] {
  const base = hostAddress({ ...a, protocol: 1 }).address
  const stem = a.platform === 'win32' ? base.slice(PIPE_DIR.length) : base.split('/').slice(-2)[0]
  const dir = a.platform === 'win32' ? PIPE_DIR : a.tmpDir.replace(/\/+$/, '')
  let names: readonly string[]
  try {
    names = a.list(dir)
  } catch {
    return []
  }
  const found: { protocol: number; address: string }[] = []
  for (const name of names) {
    const m = name === stem ? ['', '1'] : new RegExp(`^${stem}-v(\\d+)$`).exec(name)
    if (m === null) continue
    const protocol = Number(m[1])
    if (protocol === a.protocol) continue
    found.push({ protocol, address: hostAddress({ ...a, protocol }).address })
  }
  return found.sort((x, y) => x.protocol - y.protocol)
}
