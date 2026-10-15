import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// The completion block's CSS contract for a plugin check's words (plugin Phase 5c, C13). It reads styles.css as
// spinnerCss.test.ts does, here rather than under src/renderer, whose tsconfig has no node types.
const here = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(here, '../../renderer/src/styles.css'), 'utf8')

/** The declarations of the first rule whose selector list is exactly `selector`. */
const ruleOf = (selector: string): string => {
  const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`))
  if (at < 0) throw new Error(`no rule for ${selector}`)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('the completion block keeps a plugin check’s words inside it', () => {
  // 5c final review M5: a 1,000-character summary of short lines would run below the window
  it('a long summary and a hundred findings scroll in their own box', () => {
    for (const selector of ['.detail-completion-summary', '.detail-completion-diags']) {
      const rule = ruleOf(selector)
      expect(rule, selector).toMatch(/max-height:\s*160px/)
      expect(rule, selector).toMatch(/overflow:\s*auto/)
    }
  })
})
