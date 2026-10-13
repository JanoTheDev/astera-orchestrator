// Extracts a package tarball that `npm pack` fetched (plugins 2e, spec §12 "package extraction path traversal 방지",
// design P14). The Host reads the archive itself rather than trusting a tar program: every entry must stay inside the
// package, a link or a device refuses the package, and a package that unpacks past the limits is refused before it
// fills the disk. npm writes the package under a top folder (`package/`), which is dropped as npm does.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'

export class PackageRefused extends Error {
  readonly code = 'PLUGIN_PACKAGE_REFUSED'
}

const ENTRIES_MAX = 20_000
const BYTES_MAX = 256 * 1024 * 1024
const BLOCK = 512

const notTar = (): PackageRefused => new PackageRefused('the package is not a tar archive npm made')

/** A NUL-ended text field of a header. */
const text = (h: Buffer, at: number, len: number): string => {
  const field = h.subarray(at, at + len)
  const end = field.indexOf(0)
  return field.subarray(0, end < 0 ? len : end).toString('utf8')
}

/** An octal number field; a base-256 one (a size past 8 GiB) is no package's. */
const octal = (h: Buffer, at: number, len: number): number => {
  if ((h[at] & 0x80) !== 0) throw notTar()
  const s = text(h, at, len).trim()
  if (!/^[0-7]*$/.test(s)) throw notTar()
  return s === '' ? 0 : parseInt(s, 8)
}

const checksumOk = (h: Buffer): boolean => {
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]
  return sum === octal(h, 148, 8)
}

/** The `path` of a pax extended header, if it has one. */
function paxPath(body: Buffer): string | undefined {
  let found: string | undefined
  let rest = body.toString('utf8')
  while (rest.length > 0) {
    const space = rest.indexOf(' ')
    const len = parseInt(rest.slice(0, space), 10)
    if (space < 0 || !Number.isInteger(len) || len <= space) throw notTar()
    const record = rest.slice(space + 1, len - 1)
    const eq = record.indexOf('=')
    if (eq > 0 && record.slice(0, eq) === 'path') found = record.slice(eq + 1)
    rest = rest.slice(len)
  }
  return found
}

/** The entry's path inside the package (its top folder dropped), or null for the top folder itself. */
function inside(name: string): string | null {
  const leaves = (): PackageRefused => new PackageRefused(`the package has an entry that leaves the package: ${name}`)
  if (name.includes('\0') || name.includes('\\') || name.includes(':') || name.startsWith('/')) throw leaves()
  const parts = name.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.includes('..')) throw leaves()
  return parts.length <= 1 ? null : parts.slice(1).join('/')
}

export async function extractPackage(tgz: string, dest: string, limits: { entries?: number; bytes?: number } = {}): Promise<void> {
  const entriesMax = limits.entries ?? ENTRIES_MAX
  const bytesMax = limits.bytes ?? BYTES_MAX
  let tar: Buffer
  try {
    // The headers count too, so the archive may be a little larger than what it holds.
    tar = await promisify(gunzip)(await fs.readFile(tgz), { maxOutputLength: bytesMax + entriesMax * BLOCK * 2 + 2 * BLOCK })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new PackageRefused(`the package unpacks to more than ${bytesMax} bytes`)
    throw notTar()
  }
  const root = path.resolve(dest)
  await fs.mkdir(root, { recursive: true })
  let at = 0
  let entries = 0
  let bytes = 0
  let ended = false
  let nextName: string | undefined
  while (at + BLOCK <= tar.length) {
    const h = tar.subarray(at, at + BLOCK)
    at += BLOCK
    if (h.every((b) => b === 0)) {
      ended = true
      break
    }
    if (!checksumOk(h)) throw notTar()
    const size = octal(h, 124, 12)
    if (at + size > tar.length) throw notTar()
    const body = tar.subarray(at, at + size)
    at += Math.ceil(size / BLOCK) * BLOCK
    const type = String.fromCharCode(h[156] || 0x30)
    // Headers that describe the next entry.
    if (type === 'x') {
      nextName = paxPath(body) ?? nextName
      continue
    }
    if (type === 'g') continue
    if (type === 'L') {
      nextName = text(body, 0, body.length)
      continue
    }
    const prefix = text(h, 257, 6).startsWith('ustar') ? text(h, 345, 155) : ''
    const name = nextName ?? (prefix !== '' ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100))
    nextName = undefined
    if (++entries > entriesMax) throw new PackageRefused(`the package holds more than ${entriesMax} entries`)
    const rel = inside(name)
    if (type !== '0' && type !== '7' && type !== '5')
      throw new PackageRefused(`the package holds a link or a device at ${rel ?? name}; a plugin package holds files and folders only`)
    if (rel === null) continue
    const to = path.resolve(root, ...rel.split('/'))
    if (path.relative(root, to).startsWith('..') || path.isAbsolute(path.relative(root, to)))
      throw new PackageRefused(`the package has an entry that leaves the package: ${name}`)
    if (type === '5') {
      await fs.mkdir(to, { recursive: true })
      continue
    }
    bytes += size
    if (bytes > bytesMax) throw new PackageRefused(`the package unpacks to more than ${bytesMax} bytes`)
    await fs.mkdir(path.dirname(to), { recursive: true })
    // An executable stays one; nothing else of the mode is kept.
    await fs.writeFile(to, body, { mode: (octal(h, 100, 8) & 0o111) !== 0 ? 0o755 : 0o644 })
  }
  if (!ended) throw notTar()
}
