import { describe, expect, it } from 'vitest'
import { escapeHtml, renderHtml, splitForTelegram, TELEGRAM_TEXT_MAX } from './format'

describe('renderHtml', () => {
  it('escapes & < > before anything else', () => {
    expect(renderHtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d')
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;')
  })

  it('converts bold, italic and inline code', () => {
    expect(renderHtml('*done* and _later_ with `x < y`')).toBe('<b>done</b> and <i>later</i> with <code>x &lt; y</code>')
  })

  it('leaves markers inside words alone', () => {
    expect(renderHtml('snake_case_name and 2*3*4')).toBe('snake_case_name and 2*3*4')
  })

  it('does not convert inside inline code', () => {
    expect(renderHtml('`*not bold*`')).toBe('<code>*not bold*</code>')
  })

  it('renders fenced blocks as pre with their content escaped and unconverted', () => {
    expect(renderHtml('before\n```ts\nconst a = *b* < 1\n```\nafter')).toBe('before\n<pre>const a = *b* &lt; 1</pre>\nafter')
  })

  it('groups consecutive quote lines into one blockquote', () => {
    expect(renderHtml('done\n> line 1\n> line *2*\nend')).toBe('done\n<blockquote>line 1\nline <b>2</b></blockquote>\nend')
  })

  it('converts <url|label> links and bare <url> links, with quotes in the url escaped', () => {
    expect(renderHtml('<https://x.dev/a?b=1&c=2|docs>')).toBe('<a href="https://x.dev/a?b=1&amp;c=2">docs</a>')
    expect(renderHtml('<https://x.dev/"q>')).toBe('<a href="https://x.dev/&quot;q">https://x.dev/"q</a>')
  })

  it('keeps an unmatched marker as plain text', () => {
    expect(renderHtml('half *open and <tag>')).toBe('half *open and &lt;tag&gt;')
  })
})

describe('splitForTelegram', () => {
  it('keeps short text in one chunk', () => {
    expect(splitForTelegram('hi *there*')).toEqual([{ plain: 'hi *there*', html: 'hi <b>there</b>' }])
  })

  it('splits long text at newlines into chunks within 4096', () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(30)}`).join('\n')
    const chunks = splitForTelegram(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.plain.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX)
      expect(c.html.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX)
    }
    expect(chunks.map((c) => c.plain).join('')).toBe(text)
    expect(chunks[0].plain.endsWith('\n')).toBe(true)
  })

  it('splits a long line with no newline', () => {
    const chunks = splitForTelegram('y'.repeat(10_000))
    expect(chunks.map((c) => c.plain.length)).toEqual([4096, 4096, 1808])
  })

  it('shrinks chunks whose escaping would overflow the rendered limit', () => {
    const chunks = splitForTelegram('&'.repeat(5000))
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(c.html.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX)
    expect(chunks.map((c) => c.plain).join('')).toBe('&'.repeat(5000))
  })

  it('never cuts inside a tag or entity: each chunk renders balanced', () => {
    const text = '*bold* '.repeat(1500)
    for (const c of splitForTelegram(text)) {
      expect((c.html.match(/<b>/g) ?? []).length).toBe((c.html.match(/<\/b>/g) ?? []).length)
      expect(c.html).not.toMatch(/&[a-z]*$/)
    }
  })

  it('closes a fenced block at the cut and reopens it in the next chunk', () => {
    const text = '```\n' + 'code line\n'.repeat(600) + '```'
    const chunks = splitForTelegram(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.html.startsWith('<pre>')).toBe(true)
      expect(c.html.endsWith('</pre>')).toBe(true)
    }
  })

  it('does not split a surrogate pair', () => {
    const chunks = splitForTelegram('😀'.repeat(3000), 4096)
    for (const c of chunks) expect(c.plain).not.toMatch(/[\ud800-\udbff]$/)
  })
})
