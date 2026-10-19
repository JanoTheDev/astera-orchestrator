// The text of App.tsx and of the files W9-A moved its body into (state/*, components/shell/*), for the
// tests that pin App's wiring by its source (DESIGN.md §12). The invariants span these files now, so
// the tests read them as one; test files themselves are left out.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RENDERER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sources = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort()
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))

export function shellSource(): string {
  return [
    readFileSync(path.join(RENDERER, 'App.tsx'), 'utf8'),
    ...sources(path.join(RENDERER, 'state')),
    ...sources(path.join(RENDERER, 'components', 'shell'))
  ].join('\n')
}
