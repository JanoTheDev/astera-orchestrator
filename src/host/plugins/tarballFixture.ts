// Tar archives as `npm pack` writes them, for tests (plugins 2e): a gzipped ustar with pax headers, built in memory so
// a test can hold an entry no real package should.
import { gzipSync } from 'node:zlib'

/** One tar entry as the test writes it: a file (type '0'), a folder ('5'), a link ('2', '1'), a device ('3'), a pax header ('x'). */
export type Entry = { name: string; type?: string; body?: string | Buffer; prefix?: string; linkname?: string }

const header = (e: Entry, size: number): Buffer => {
  const h = Buffer.alloc(512)
  h.write(e.name, 0, 100, 'utf8')
  h.write('0000644\0', 100, 'ascii')
  h.write('0000000\0', 108, 'ascii')
  h.write('0000000\0', 116, 'ascii')
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
  h.write('00000000000\0', 136, 'ascii')
  h.write('        ', 148, 'ascii')
  h.write(e.type ?? '0', 156, 'ascii')
  if (e.linkname) h.write(e.linkname, 157, 100, 'utf8')
  h.write('ustar\0', 257, 'ascii')
  h.write('00', 263, 'ascii')
  if (e.prefix) h.write(e.prefix, 345, 155, 'utf8')
  let sum = 0
  for (const b of h) sum += b
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  return h
}

/** A gzipped tar of `entries`, as `npm pack` writes one. */
export function tgzOf(entries: Entry[], o: { end?: boolean } = {}): Buffer {
  const parts: Buffer[] = []
  for (const e of entries) {
    const body = Buffer.isBuffer(e.body) ? e.body : Buffer.from(e.body ?? '', 'utf8')
    parts.push(header(e, body.length), body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  if (o.end !== false) parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}

export const pax = (records: Record<string, string>): string =>
  Object.entries(records)
    .map(([k, v]) => {
      const rest = ` ${k}=${v}\n`
      let len = rest.length + 1
      while (`${len}${rest}`.length !== len) len = `${len}${rest}`.length
      return `${len}${rest}`
    })
    .join('')
