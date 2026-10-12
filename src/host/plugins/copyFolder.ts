// Copies a plugin's folder into the profile (plugin runtime design P7). The copy holds plain files and folders only: a
// link that stays inside the plugin is followed and what it leads to is copied (Windows cannot recreate a file link
// without a privilege), and a link that leads outside, leads nowhere or loops refuses the install, so what is installed
// is the folder the person approved and nothing it points at.
import { promises as fs } from 'node:fs'
import path from 'node:path'

export class PluginCopyRefused extends Error {
  readonly code = 'PLUGIN_COPY_REFUSED'
}

/** `b` is `a` or inside it. */
const within = (a: string, b: string): boolean => {
  const r = path.relative(a, b)
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r))
}

export async function copyPluginFolder(src: string, dest: string): Promise<void> {
  const root = await fs.realpath(src)
  const target = path.resolve(dest)
  if (within(path.resolve(src), target) || within(root, target))
    throw new PluginCopyRefused(`${dest} is inside the folder it copies`)
  await fs.mkdir(target, { recursive: true })
  await copyInto(root, [root], target, '')
}

/** Copies the folder at the end of `chain` into `to`. `chain` is the real path of every folder the walk is inside, from
 *  the root down, so a link back to any of them is a loop however many links it took to get there. `rel` is the path
 *  from the plugin's root, with `/`, for messages. */
async function copyInto(root: string, chain: readonly string[], to: string, rel: string): Promise<void> {
  const from = chain[chain.length - 1]
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    // Git's own folder at the top is history, not the plugin; a dependency's deeper down is whatever it shipped.
    if (rel === '' && e.name === '.git') continue
    const at = rel === '' ? e.name : `${rel}/${e.name}`
    const full = path.join(from, e.name)
    const into = path.join(to, e.name)
    if (e.isSymbolicLink()) {
      let real: string
      try {
        real = await fs.realpath(full)
      } catch {
        throw new PluginCopyRefused(`${at} is a link to something that is not there`)
      }
      if (!within(root, real))
        throw new PluginCopyRefused(`${at} is a link that leads outside the plugin; bundle it or replace the link with a copy`)
      const st = await fs.stat(real)
      if (st.isDirectory()) {
        // Following a link to a folder this one sits in would copy forever.
        if (chain.some((c) => within(real, c))) throw new PluginCopyRefused(`${at} is a link back to a folder it sits in`)
        await fs.mkdir(into)
        await copyInto(root, [...chain, real], into, at)
      } else if (st.isFile()) await fs.copyFile(real, into)
      else throw new PluginCopyRefused(`${at} is not a file or a folder`)
    } else if (e.isDirectory()) {
      await fs.mkdir(into)
      await copyInto(root, [...chain, full], into, at)
    } else if (e.isFile()) await fs.copyFile(full, into)
    else throw new PluginCopyRefused(`${at} is not a file or a folder`)
  }
}
