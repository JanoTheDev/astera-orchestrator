// Builds the SDK packages under packages/ (SDK 1a, docs/superpowers/plans/2026-10-12-sdk-1a-contract-package.md):
// ESM and CommonJS, each with declarations, using the TypeScript the app already has, so the packages add no build
// dependency. `--out <dir>` builds into <dir>/<package> instead of the package's own dist (the test does that).
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// typescript's exports map opens package.json but not bin/tsc, so the bin is found next to the manifest
const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc')

export const PACKAGES = ['client']

export function buildPackage(name, outRoot = null) {
  const dir = path.join(root, 'packages', name)
  const dist = outRoot ? path.join(outRoot, name) : path.join(dir, 'dist')
  rmSync(dist, { recursive: true, force: true })
  for (const [config, sub] of [['tsconfig.esm.json', 'esm'], ['tsconfig.cjs.json', 'cjs']])
    execFileSync(process.execPath, [tsc, '-p', path.join(dir, config), '--outDir', path.join(dist, sub)], { stdio: 'inherit' })
  // Each half says what its .js files are, so they load the same inside the package and copied anywhere else
  writeFileSync(path.join(dist, 'esm', 'package.json'), '{\n  "type": "module"\n}\n')
  writeFileSync(path.join(dist, 'cjs', 'package.json'), '{\n  "type": "commonjs"\n}\n')
  return dist
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out')
  const out = i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null
  for (const p of PACKAGES) console.log(`built ${p}: ${buildPackage(p, out)}`)
}
