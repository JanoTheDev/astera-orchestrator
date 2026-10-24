/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Class names of the old design whose CSS rules were deleted. A component that still writes one gets no
// style, and if a rule ever comes back under the same name, the old look comes back with it. The house
// primitives in components/ui own these looks now, so the guard covers the components outside ui/.
const REMOVED = [
  'modal-backdrop',
  'modal-hint',
  'kind-field',
  'kind-segmented',
  'jobs-concurrency',
  'jobs-sched',
  'sched-kind',
  'history-account-filter',
  'panel-header',
  'panel-actions',
  'icon-btn',
  'warn-text',
]

const ROOT = path.join(__dirname, '..')
const COMPONENTS = path.join(ROOT, 'components')
const UI = path.join(COMPONENTS, 'ui')

const componentFiles = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (p !== UI) componentFiles(p, out)
    } else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) out.push(p)
  }
  return out
}

// Every word inside each className attribute: a literal, a template, or the branches of a `{cond ? … : …}`.
// A JS identifier cannot contain '-', so each removed name matches only as a whole class token.
const classNameTokens = (src: string): string[] => {
  const out: string[] = []
  for (const m of src.matchAll(/className\s*=\s*/g)) {
    const start = m.index! + m[0].length
    const open = src[start]
    let end = start + 1
    if (open === '"' || open === "'") {
      const close = src.indexOf(open, start + 1)
      end = close === -1 ? src.length : close
    } else if (open === '{') {
      let depth = 0
      for (; end < src.length; end++) {
        if (src[end] === '{') depth++
        else if (src[end] === '}' && depth-- === 0) break
      }
    }
    out.push(...(src.slice(start, end).match(/[\w-]+/g) ?? []))
  }
  return out
}

describe('no removed legacy class name in a component', () => {
  const files = componentFiles(COMPONENTS)

  it('finds the components — an empty walk would make the next check pass on nothing', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('no className names a removed legacy class', () => {
    const hits: string[] = []
    for (const f of files) {
      for (const tok of classNameTokens(readFileSync(f, 'utf8'))) {
        if (REMOVED.includes(tok)) hits.push(`${path.relative(ROOT, f)}: ${tok}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('the scan catches a removed name in a literal, a template and a branch', () => {
    const sample = `<a className="modal-hint" /><b className={c ? 'icon-btn' : 'x'} /><i className={\`x \${y} panel-header\`} />`
    expect(classNameTokens(sample).filter((t) => REMOVED.includes(t))).toEqual([
      'modal-hint',
      'icon-btn',
      'panel-header',
    ])
  })
})
