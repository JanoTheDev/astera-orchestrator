// T28: the third-party notices Settings › About lists. scripts/gen-licenses.mjs writes the file before packaging
// (resources/licenses.json when packaged, build/licenses.json in a checkout); a dev run without it gets null, and
// the renderer says how to generate it.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { LicenseEntry } from '../core/types'

const KINDS: readonly LicenseEntry['kind'][] = ['package', 'runtime', 'font']
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The file is ours but still crosses a disk: anything that is not a notice entry is dropped, not trusted. */
export function parseLicenses(raw: string): LicenseEntry[] | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const list = (json as { entries?: unknown } | null)?.entries
  if (!Array.isArray(list)) return null
  return list.flatMap((e): LicenseEntry[] => {
    const kind = (e as { kind?: unknown } | null)?.kind
    const name = str((e as { name?: unknown } | null)?.name)
    if (!name || !KINDS.includes(kind as LicenseEntry['kind'])) return []
    const o = e as Record<string, unknown>
    return [{ kind: kind as LicenseEntry['kind'], name, version: str(o.version), license: str(o.license), text: str(o.text) }]
  })
}

/** The entries, or null when the file is missing or unreadable. */
export async function readLicenses(file: string): Promise<LicenseEntry[] | null> {
  try {
    return parseLicenses(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** Where the generated file is: next to the app's resources when packaged, in build/ of the checkout otherwise. */
export const licensesFile = (b: { packaged: boolean; resourcesPath: string; appPath: string }): string =>
  b.packaged ? path.join(b.resourcesPath, 'licenses.json') : path.join(b.appPath, 'build', 'licenses.json')
