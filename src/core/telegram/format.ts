// Turns the notifier's Slack-style text (core/connections/notifier.ts writes `> ` quote lines, and the
// message catalogue uses `*bold*`, `_italic_`, backticks and `<url|label>`) into Telegram's HTML subset, and
// cuts it into messages Telegram accepts. Pure, so every rule is pinned by a test.
//
// Escaping comes first and conversion second: whatever this file cannot convert stays as escaped plain text,
// so a stray `<` or `&` can never make Telegram reject the message.

/** Telegram's cap on one message's text, counted after its entities are parsed (so the rendered HTML,
 *  tags included, is a safe upper bound). */
export const TELEGRAM_TEXT_MAX = 4096

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// A marker counts only at a word edge, so snake_case and 2*3*4 stay as typed.
const BOLD = /(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g
const ITALIC = /(^|[^\w_])_([^_\n]+)_(?![\w_])/g
const LINK = /&lt;(https?:\/\/[^|\s]+?)(?:\|(.+?))?&gt;/g

function inline(raw: string): string {
  return raw
    .split(/(`[^`\n]+`)/)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      return escapeHtml(part)
        .replace(LINK, (_m, url: string, label?: string) => `<a href="${url.replace(/"/g, '&quot;')}">${label ?? url}</a>`)
        .replace(BOLD, '$1<b>$2</b>')
        .replace(ITALIC, '$1<i>$2</i>')
    })
    .join('')
}

/** Lines outside a fenced block: consecutive `> ` lines become one blockquote. */
function lines(raw: string): string {
  const out: string[] = []
  let quote: string[] = []
  const flush = (): void => {
    if (quote.length) out.push(`<blockquote>${quote.join('\n')}</blockquote>`)
    quote = []
  }
  for (const line of raw.split('\n')) {
    if (line.startsWith('> ')) quote.push(inline(line.slice(2)))
    else {
      flush()
      out.push(inline(line))
    }
  }
  flush()
  return out.join('\n')
}

/** The notifier's text as Telegram HTML (parse_mode 'HTML'). */
export function renderHtml(text: string): string {
  return text
    .split(/(```[^\n`]*\n?[\s\S]*?```)/)
    .map((part, i) => {
      if (i % 2 === 0) return lines(part)
      const body = part.slice(3, -3).replace(/^[^\n`]*\n/, '')
      return `<pre>${escapeHtml(body.replace(/\n$/, ''))}</pre>`
    })
    .join('')
}

/** One message: the source text (for the plain-text retry) and what it renders to. */
export interface Chunk {
  plain: string
  html: string
}

/** Cuts `text` into messages that fit TELEGRAM_TEXT_MAX both as source and as rendered HTML, preferring a
 *  newline as the cut. Each chunk is rendered on its own, so a cut never lands inside a tag or entity; a
 *  fenced block that spans a cut is closed in the first chunk and reopened in the next. */
export function splitForTelegram(text: string, max = TELEGRAM_TEXT_MAX): Chunk[] {
  const chunks: Chunk[] = []
  let rest = text
  let reopen = false
  while (rest !== '' || chunks.length === 0) {
    let size = Math.min(rest.length, max)
    for (;;) {
      let cut = size
      if (cut < rest.length) {
        const nl = rest.lastIndexOf('\n', cut - 1)
        if (nl > cut / 2) cut = nl + 1
        // never between the halves of a surrogate pair
        const c = rest.charCodeAt(cut - 1)
        if (cut < rest.length && c >= 0xd800 && c <= 0xdbff) cut--
      }
      let plain: string = (reopen ? '```\n' : '') + rest.slice(0, cut)
      const spans: boolean = cut < rest.length && (plain.match(/```/g)?.length ?? 0) % 2 === 1
      if (spans) plain += '\n```'
      const html = renderHtml(plain)
      if ((plain.length <= max && html.length <= max) || size <= 1) {
        chunks.push({ plain, html })
        rest = rest.slice(cut)
        reopen = spans
        break
      }
      size = Math.max(1, Math.floor(size * 0.9) - 8)
    }
  }
  return chunks
}
