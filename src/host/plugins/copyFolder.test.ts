import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PluginCopyRefused, copyPluginFolder } from './copyFolder'

let dir: string
let src: string
let dest: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-plugin-copy-'))
  // Spec §48: a space and a non-ASCII name in the path.
  src = path.join(dir, 'my plugin 플러그인')
  dest = path.join(dir, 'installed 설치')
  await fs.mkdir(path.join(src, 'dist'), { recursive: true })
  await fs.writeFile(path.join(src, 'package.json'), '{"name":"x"}')
  await fs.writeFile(path.join(src, 'dist', 'plugin.js'), 'export default {}')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** A folder link: a junction on Windows, which needs no privilege; a symlink elsewhere. */
const linkFolder = (target: string, at: string): Promise<void> =>
  fs.symlink(target, at, process.platform === 'win32' ? 'junction' : 'dir')

/** Every path under `root`, relative and with `/`, sorted. */
async function tree(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string, rel: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`
      out.push(e.isDirectory() ? `${r}/` : e.isSymbolicLink() ? `${r}@` : r)
      if (e.isDirectory()) await walk(path.join(d, e.name), r)
    }
  }
  await walk(root, '')
  return out.sort()
}

const refusal = async (p: Promise<void>): Promise<string> => {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(PluginCopyRefused)
    expect((e as PluginCopyRefused).code).toBe('PLUGIN_COPY_REFUSED')
    return (e as Error).message
  }
  throw new Error('expected a refusal')
}

describe('copyPluginFolder', () => {
  it('copies files and folders', async () => {
    await copyPluginFolder(src, dest)
    expect(await tree(dest)).toEqual(['dist/', 'dist/plugin.js', 'package.json'])
    expect(await fs.readFile(path.join(dest, 'dist', 'plugin.js'), 'utf8')).toBe('export default {}')
  })

  it('skips .git at the top and keeps one deeper down', async () => {
    await fs.mkdir(path.join(src, '.git'))
    await fs.writeFile(path.join(src, '.git', 'HEAD'), 'ref')
    await fs.mkdir(path.join(src, 'node_modules', 'dep', '.git'), { recursive: true })
    await fs.writeFile(path.join(src, 'node_modules', 'dep', '.git', 'HEAD'), 'ref')
    await copyPluginFolder(src, dest)
    const got = await tree(dest)
    expect(got).not.toContain('.git/')
    expect(got).toContain('node_modules/dep/.git/HEAD')
  })

  it('follows a folder link that stays inside, and copies what it leads to as a plain folder', async () => {
    await fs.mkdir(path.join(src, 'node_modules', 'real'), { recursive: true })
    await fs.writeFile(path.join(src, 'node_modules', 'real', 'index.js'), 'module.exports = 1')
    await linkFolder(path.join(src, 'node_modules', 'real'), path.join(src, 'node_modules', 'alias'))
    await copyPluginFolder(src, dest)
    const got = await tree(dest)
    expect(got).toContain('node_modules/alias/')
    expect(got).toContain('node_modules/alias/index.js')
    expect(got.some((p) => p.endsWith('@'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('follows a file link that stays inside (posix: npm .bin links)', async () => {
    await fs.mkdir(path.join(src, 'node_modules', '.bin'), { recursive: true })
    await fs.symlink('../../dist/plugin.js', path.join(src, 'node_modules', '.bin', 'tool'))
    await copyPluginFolder(src, dest)
    const st = await fs.lstat(path.join(dest, 'node_modules', '.bin', 'tool'))
    expect(st.isFile()).toBe(true)
  })

  it('refuses a link that leads outside the plugin, naming it', async () => {
    const outside = path.join(dir, 'elsewhere')
    await fs.mkdir(outside)
    await fs.mkdir(path.join(src, 'node_modules'))
    await linkFolder(outside, path.join(src, 'node_modules', 'linked'))
    expect(await refusal(copyPluginFolder(src, dest))).toBe(
      'node_modules/linked is a link that leads outside the plugin; bundle it or replace the link with a copy'
    )
  })

  it('refuses a link that leads nowhere', async () => {
    const gone = path.join(src, 'gone')
    await fs.mkdir(gone)
    await linkFolder(gone, path.join(src, 'dangling'))
    await fs.rmdir(gone)
    expect(await refusal(copyPluginFolder(src, dest))).toBe('dangling is a link to something that is not there')
  })

  it('refuses a folder link back to a folder it sits in', async () => {
    await linkFolder(src, path.join(src, 'dist', 'loop'))
    expect(await refusal(copyPluginFolder(src, dest))).toBe('dist/loop is a link back to a folder it sits in')
  })

  it('refuses two folder links that lead to each other', async () => {
    await fs.mkdir(path.join(src, 'a'))
    await fs.mkdir(path.join(src, 'b'))
    await linkFolder(path.join(src, 'b'), path.join(src, 'a', 'to-b'))
    await linkFolder(path.join(src, 'a'), path.join(src, 'b', 'to-a'))
    expect(await refusal(copyPluginFolder(src, dest))).toMatch(/^(a\/to-b\/to-a|b\/to-a\/to-b) is a link back to a folder it sits in$/)
  })

  it('copies two links to one folder twice, which is no loop', async () => {
    await fs.mkdir(path.join(src, 'shared'))
    await fs.writeFile(path.join(src, 'shared', 'x.js'), '1')
    await linkFolder(path.join(src, 'shared'), path.join(src, 'one'))
    await linkFolder(path.join(src, 'shared'), path.join(src, 'two'))
    await copyPluginFolder(src, dest)
    expect(await tree(dest)).toEqual(expect.arrayContaining(['one/x.js', 'two/x.js', 'shared/x.js']))
  })

  it('refuses a destination inside the plugin', async () => {
    expect(await refusal(copyPluginFolder(src, path.join(src, 'dist', 'copy')))).toMatch(/inside the folder it copies/)
  })
})
