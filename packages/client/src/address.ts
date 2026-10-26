// Where the Host listens. Derived from the profile directory, so the dev app, the installed app and
// a throwaway verification profile each get their own Host and never meet.
//
// Pure, and the platform arrives as an argument rather than being read from `process`: this module's
// tests run on windows, macos and ubuntu, and a module that asks the host which platform it is on
// can only be tested on one of them.
import { createHash } from 'node:crypto'

/** Long enough that two profiles on one machine will not collide, short enough to keep the posix
 *  socket path far inside its ~104 byte limit. */
const KEY_LENGTH = 12

export interface HostAddress {
  /** What `net.createServer().listen()` and `net.connect()` take. */
  address: string
  /** posix only: the directory to create with mode 0700 *before* binding, so the socket is never
   *  briefly world-reachable. Locking the directory rather than the socket file is what removes that
   *  window — a socket created and then chmoded has one.
   *
   *  **null on win32, and that is not the same as "the pipe is private".** An earlier note here said
   *  the default security descriptor admits only this user and administrators. Measured 2026-09-21,
   *  it does not: `D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<user>)(A;;FR;;;WD)(A;;FR;;;AN)` — Everyone and
   *  ANONYMOUS LOGON both get FILE_GENERIC_READ. Node's `net` has no way to set a pipe's ACL, so
   *  there is nothing to return here. What keeps another local user from hearing anything is that
   *  read access alone cannot complete the handshake, and the Host broadcasts only to peers that
   *  have (`greetedSockets` in server.ts). */
  dirToPrepare: string | null
}

/** Where every named pipe lives on win32. Listing it lists the pipes that exist right now. */
export const PIPE_DIR = '\\\\.\\pipe\\'

/** The protocol is part of the address, not something to discover after connecting. From slice 2 a
 *  Host holds live terminals, so an app that cannot speak its protocol must not reach it at all —
 *  and an address that already says which protocol lives there makes that impossible rather than
 *  merely handled.
 *
 *  Protocol 1 gets no suffix: that is the name version 1 already called itself, before this existed,
 *  and giving it a `-v1` it never bound would make `retireOlderHosts` probe an address no v1 Host has
 *  ever listened on. The suffix marks protocols after the first; the original's name is its own. */
export function hostAddress(a: {
  profileDir: string
  platform: NodeJS.Platform
  tmpDir: string
  protocol: number
}): HostAddress {
  const key = createHash('sha256').update(a.profileDir).digest('hex').slice(0, KEY_LENGTH)
  const name = a.protocol === 1 ? `astera-host-${key}` : `astera-host-${key}-v${a.protocol}`
  if (a.platform === 'win32') return { address: PIPE_DIR + name, dirToPrepare: null }
  const dir = `${a.tmpDir.replace(/\/+$/, '')}/${name}`
  return { address: `${dir}/sock`, dirToPrepare: dir }
}
