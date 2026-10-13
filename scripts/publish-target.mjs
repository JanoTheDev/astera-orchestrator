// Which SDK package a publish names (docs/releasing.md, "Publishing the SDK packages"): the tag `client-v0.1.1` is
// packages/client at 0.1.1, and the version must be the one its package.json holds, as release.yml requires of the
// app's tag. .github/workflows/publish-packages.yml runs it and reads what it writes:
//
//   node scripts/publish-target.mjs --tag client-v0.1.1     dir=client, name=@astera-app/client, version=0.1.1
//   node scripts/publish-target.mjs --package plugin-sdk    the same for a dry run, at the version it holds
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain, PACKAGES } from './build-packages.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readManifest = (dir) => JSON.parse(readFileSync(path.join(root, 'packages', dir, 'package.json'), 'utf8'))
const target = (dir, m) => ({ dir, name: m.name, version: m.version })

/** The package a tag publishes. Throws, saying what to push, when the tag names none or another version. */
export function publishTarget(tag, read = readManifest) {
  const m = /^(.+)-v(\d+\.\d+\.\d+)$/.exec(tag)
  if (!m || !PACKAGES.includes(m[1])) throw new Error(`${tag} names no package: a publish tag is ${PACKAGES.map((p) => `${p}-vX.Y.Z`).join(' or ')}`)
  const [, dir, version] = m
  const pkg = read(dir)
  if (pkg.version !== version)
    throw new Error(`${tag} does not match packages/${dir}/package.json (${pkg.version}): push ${dir}-v${pkg.version}, or change its version first`)
  return target(dir, pkg)
}

/** A package by its folder, at the version it holds: what a dry run tries. */
export function dryRunTarget(dir, read = readManifest) {
  if (!PACKAGES.includes(dir)) throw new Error(`${dir} is not a package: ${PACKAGES.join(' or ')}`)
  return target(dir, read(dir))
}

if (isMain(process.argv[1], import.meta.url)) {
  const [flag, value] = process.argv.slice(2)
  try {
    if (value === undefined || (flag !== '--tag' && flag !== '--package')) throw new Error('usage: publish-target.mjs --tag <tag> | --package <folder>')
    const t = flag === '--tag' ? publishTarget(value) : dryRunTarget(value)
    process.stdout.write(`dir=${t.dir}\nname=${t.name}\nversion=${t.version}\n`)
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exitCode = 1
  }
}
