// For tests: the launcher bundled the way electron-vite bundles it for the app (one CommonJS file, Node built-ins left
// to Node), so a test can run it as a real child process with `process.execPath`.
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts')

/** Bundles the launcher into `dir` and returns the file. */
export async function bundleLauncher(dir: string): Promise<string> {
  const outfile = path.join(dir, 'plugin-host.cjs')
  await build({ entryPoints: [ENTRY], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile, logLevel: 'silent' })
  return outfile
}
