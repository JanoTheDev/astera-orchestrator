// Type-checks with the repo's own tsc (TypeScript 7 has no JS API, so it runs as a process): the SDK examples
// through their tsconfig, and the TypeScript blocks of docs/sdk.md and the package README as files of their own,
// against the package source as a reader's `import ... from '@astera-app/client'` would see it.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

/** The examples' compiler options (examples/sdk/tsconfig.json has the same). */
export const EXAMPLE_OPTIONS = {
  target: 'ES2022',
  lib: ['ES2022'],
  module: 'NodeNext',
  moduleResolution: 'NodeNext',
  strict: true,
  noEmit: true,
  verbatimModuleSyntax: true,
  erasableSyntaxOnly: true,
  skipLibCheck: true,
  types: ['node']
}

/** Names a block may use without making them: by then the guide's reader has a client and the ids it names. */
const GIVEN: Readonly<Record<string, string>> = {
  astera: "import('@astera-app/client').AsteraClient",
  projectId: 'string',
  jobId: 'string',
  runId: 'string',
  taskId: 'string',
  questionId: 'string',
  requestId: 'string',
  cursor: 'string',
  signal: 'AbortSignal',
  // docs/plugins.md: by then its reader is inside a plugin's activate
  ctx: "import('@astera-app/plugin-sdk').PluginContext"
}

/** tsc's output for a project: '' when it compiles. */
export function runTsc(project: string): string {
  try {
    execFileSync(process.execPath, [TSC, '-p', project, '--pretty', 'false'], { encoding: 'utf8', stdio: 'pipe' })
    return ''
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; message: string }
    return `${x.stdout ?? ''}${x.stderr ?? ''}` || x.message
  }
}

/** Each block as a module of its own (`blockN.mts`), with a `declare const` for each GIVEN name it uses and does not
 *  make. tsc's output names the block by its number, counted from 1 in the order given. */
export function typecheckBlocks(blocks: readonly string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-blocks '))
  try {
    const files = blocks.map((code, i) => {
      const given = Object.entries(GIVEN).filter(
        ([name]) => new RegExp(`\\b${name}\\b`).test(code) && !new RegExp(`\\b(?:const|let|var)\\s+(?:\\{[^}]*)?\\b${name}\\b`).test(code)
      )
      const file = path.join(dir, `block${i + 1}.mts`)
      writeFileSync(file, `${given.map(([n, t]) => `declare const ${n}: ${t}\n`).join('')}${code}\nexport {}\n`)
      return file
    })
    const config = {
      compilerOptions: {
        ...EXAMPLE_OPTIONS,
        typeRoots: [path.join(ROOT, 'node_modules', '@types')],
        paths: {
          '@astera-app/client': [path.join(ROOT, 'packages', 'client', 'src', 'index.ts')],
          '@astera-app/plugin-sdk': [path.join(ROOT, 'packages', 'plugin-sdk', 'src', 'index.ts')]
        }
      },
      files
    }
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(config))
    return runTsc(path.join(dir, 'tsconfig.json'))
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Still held on Windows: an `astera-` folder the suite's sweeper removes once stale (vitest.globalSetup.ts). This
      // helper may not import the app's removeFixture (fence.test.ts), so it keeps the same rule here.
    }
  }
}
