// The third-party notices a packaged Astera carries (Settings › About › Open source licenses). Walks the
// production dependency tree from package-lock.json (no `npm ls`, so it also runs on a checkout that is not installed),
// reads each package's license field and its LICENSE/NOTICE files from node_modules, and writes build/licenses.json,
// which electron-builder ships as a resource (extraResources, electron-builder.yml). No dependency.
//   node scripts/gen-licenses.mjs [--out <file>]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from './build-packages.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The lockfile's production packages: every entry that is not dev-only, not a workspace link and not the root.
 *  `devOptional` stays (an optional production dependency reaches it). One entry per name@version. */
export function productionPackages(lock) {
  const seen = new Map()
  for (const [key, p] of Object.entries(lock.packages ?? {})) {
    if (key === '' || p.dev || p.link || !p.version) continue
    const name = p.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
    const id = `${name}@${p.version}`
    if (!seen.has(id)) seen.set(id, { name, version: p.version, license: p.license, dirs: [] })
    seen.get(id).dirs.push(key)
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/** One license string from the shapes package.json has had: "MIT", { type }, [{ type }, ...]. */
export function licenseName(v) {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (Array.isArray(v)) {
    const names = v.map(licenseName).filter(Boolean)
    return names.length ? `(${names.join(' OR ')})` : ''
  }
  if (v && typeof v === 'object' && typeof v.type === 'string' && v.type.trim()) return v.type.trim()
  return ''
}

const NOTICE_FILE = /^(licen[sc]e|licen[sc]es|copying|notice|unlicense)([-_.].*)?$/i
const NOT_TEXT = /\.(js|mjs|cjs|ts|json|map|png|jpe?g|gif|svg|ico|woff2?|ttf)$/i

/** The license and notice files among a folder's file names: LICENSE before NOTICE, otherwise by name. */
export function noticeFiles(names) {
  const rank = (n) => (/^notice/i.test(n) ? 1 : 0)
  return names.filter((n) => NOTICE_FILE.test(n) && !NOT_TEXT.test(n)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** A package's notice text: its notice files, joined; '' when it ships none. */
export function noticeText(dir, { list = (d) => readdirSync(d), read = (f) => readFileSync(f, 'utf8') } = {}) {
  let names
  try {
    names = noticeFiles(list(dir))
  } catch {
    return ''
  }
  const texts = []
  for (const n of names) {
    try {
      const t = read(path.join(dir, n)).replace(/\r\n/g, '\n').trim()
      if (t) texts.push(t)
    } catch {
      // unreadable (a directory called LICENSES, say): the others still count
    }
  }
  return texts.join('\n\n---\n\n')
}

/** What Electron's own packaging adds that no lockfile lists (electron-builder puts the first beside the app). */
const CHROMIUM_NOTE =
  'Astera runs on Chromium, which bundles many open source components. Their notices ship with the app as ' +
  'LICENSES.chromium.html, in the application folder.'

/** The whole file. `fs` is the filesystem the packages are read from, so a test can hand in a small tree. */
export function buildLicenses({ lock, nodeModulesOf, fontLicenses = [], fs = {} }) {
  const entries = []
  for (const p of productionPackages(lock)) {
    const dir = p.dirs.map(nodeModulesOf).find((d) => d && (fs.exists ?? existsSync)(d))
    let license = licenseName(p.license)
    if (!license && dir) {
      try {
        license = licenseName(JSON.parse((fs.read ?? ((f) => readFileSync(f, 'utf8')))(path.join(dir, 'package.json'))).license)
      } catch {
        // no readable package.json: the entry says UNKNOWN below
      }
    }
    entries.push({ kind: 'package', name: p.name, version: p.version, license: license || 'UNKNOWN', text: dir ? noticeText(dir, fs) : '' })
  }
  const electron = lock.packages?.['node_modules/electron']
  if (electron?.version) {
    const dir = nodeModulesOf('node_modules/electron')
    entries.push({ kind: 'runtime', name: 'Electron', version: electron.version, license: 'MIT', text: dir ? noticeText(dir, fs) : '' })
  }
  entries.push({ kind: 'runtime', name: 'Chromium', version: '', license: 'BSD-3-Clause and others', text: CHROMIUM_NOTE })
  for (const f of fontLicenses) entries.push({ kind: 'font', name: f.name, version: '', license: 'OFL-1.1', text: f.text })
  return { entries }
}

/** The bundled fonts' OFL texts: resources/font-licenses/<Family>/OFL.txt. */
export function readFontLicenses(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, text: noticeText(path.join(dir, d.name)) || readFileSync(path.join(dir, d.name, 'OFL.txt'), 'utf8').trim() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

if (isMain(process.argv[1], import.meta.url)) {
  const i = process.argv.indexOf('--out')
  const out = i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : path.join(root, 'build', 'licenses.json')
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const file = buildLicenses({
    lock,
    nodeModulesOf: (key) => path.join(root, key),
    fontLicenses: readFontLicenses(path.join(root, 'resources', 'font-licenses'))
  })
  const missing = file.entries.filter((e) => e.kind === 'package' && !e.text).length
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(file))
  console.log(`licenses: ${file.entries.length} entries (${missing} packages without a license file) -> ${out}`)
}
