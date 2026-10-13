import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { PackageRefused, extractPackage } from './tarball'
import { pax, tgzOf } from './tarballFixture'

let dir: string
let dest: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-tarball-'))
  dest = path.join(dir, 'out 플러그인')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const write = async (tgz: Buffer): Promise<string> => {
  const f = path.join(dir, 'p.tgz')
  await fs.writeFile(f, tgz)
  return f
}
const refusal = async (tgz: Buffer, limits?: { entries?: number; bytes?: number }): Promise<string> => {
  const e = await extractPackage(await write(tgz), dest, limits).catch((err: unknown) => err)
  expect(e).toBeInstanceOf(PackageRefused)
  return (e as Error).message
}
const outside = (): string[] => [path.join(dir, 'evil.txt'), path.join(dir, 'x'), path.join(os.tmpdir(), 'astera-evil.txt')].filter((p) => existsSync(p))

// Plugins 2e (spec §12 "package extraction path traversal 방지", design P14).
describe('extractPackage', () => {
  it('writes the package without its top folder, as npm does, long paths included', async () => {
    const long = `${'d'.repeat(60)}/${'e'.repeat(60)}`
    await extractPackage(
      await write(
        tgzOf([
          { name: 'package/package.json', body: '{"name":"x","version":"1.0.0"}' },
          { name: 'package/lib', type: '5' },
          { name: 'package/lib/index.js', body: 'export default {}' },
          { name: 'index.js', prefix: `package/${long}`, body: 'deep' },
          { name: 'PaxHeader', type: 'x', body: pax({ path: `package/${'p'.repeat(120)}.js` }) },
          { name: 'package/short-name-replaced-by-pax', body: 'from pax' }
        ])
      ),
      dest
    )
    expect(JSON.parse(await fs.readFile(path.join(dest, 'package.json'), 'utf8'))).toEqual({ name: 'x', version: '1.0.0' })
    expect(await fs.readFile(path.join(dest, 'lib', 'index.js'), 'utf8')).toBe('export default {}')
    expect(await fs.readFile(path.join(dest, long, 'index.js'), 'utf8')).toBe('deep')
    expect(await fs.readFile(path.join(dest, `${'p'.repeat(120)}.js`), 'utf8')).toBe('from pax')
  })

  it('refuses an entry that leaves the package, and writes nothing outside it', async () => {
    for (const name of ['package/../evil.txt', '../evil.txt', '/tmp/astera-evil.txt', 'package/a/../../evil.txt', 'C:evil.txt', 'package/C:/evil.txt', 'package\\..\\evil.txt'])
      expect(await refusal(tgzOf([{ name: 'package/ok.js', body: 'ok' }, { name, body: 'bad' }])), name).toContain('leaves the package')
    expect(await refusal(tgzOf([{ name: 'x', type: 'x', body: pax({ path: 'package/../../evil.txt' }) }, { name: 'package/fine.js', body: 'bad' }]))).toContain(
      'leaves the package'
    )
    expect(outside()).toEqual([])
  })

  it('refuses a link or a device, which a plugin package does not hold', async () => {
    expect(await refusal(tgzOf([{ name: 'package/l', type: '2', linkname: '../../evil.txt' }]))).toBe('the package holds a link or a device at l; a plugin package holds files and folders only')
    expect(await refusal(tgzOf([{ name: 'package/h', type: '1', linkname: 'package/x' }]))).toContain('a link or a device at h')
    expect(await refusal(tgzOf([{ name: 'package/c', type: '3' }]))).toContain('a link or a device at c')
  })

  it('refuses a package past the limits, and what is not a whole tar archive', async () => {
    expect(await refusal(tgzOf([{ name: 'package/a', body: 'a' }, { name: 'package/b', body: 'b' }, { name: 'package/c', body: 'c' }]), { entries: 2 })).toBe(
      'the package holds more than 2 entries'
    )
    expect(await refusal(tgzOf([{ name: 'package/big', body: Buffer.alloc(5000) }]), { bytes: 4096 })).toBe('the package unpacks to more than 4096 bytes')
    expect(await refusal(gzipSync(Buffer.from('not a tar archive at all, just some text that is long enough'.repeat(20))))).toBe(
      'the package is not a tar archive npm made'
    )
    const whole = tgzOf([{ name: 'package/a.js', body: 'x'.repeat(2000) }], { end: false })
    const { gunzipSync } = await import('node:zlib')
    expect(await refusal(gzipSync(gunzipSync(whole).subarray(0, 900)))).toBe('the package is not a tar archive npm made')
    expect(await refusal(Buffer.from('plain text, not gzip'))).toBe('the package is not a tar archive npm made')
  })
})
