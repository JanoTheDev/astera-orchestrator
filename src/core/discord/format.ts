// Turns the notifier's Slack-style text (core/connections/notifier.ts: `*bold*`, `_italic_`, backticks,
// `> ` quotes and `<url|label>` links) into Discord markdown, and makes channel names Discord accepts. Pure,
// so every rule is pinned by a test. Code (fenced or inline) is never rewritten.

/** Discord's cap on one message's content. */
export const DISCORD_TEXT_MAX = 2000
/** Discord's cap on a channel name. */
export const CHANNEL_NAME_MAX = 100

// A marker counts only at a word edge, so 2*3*4 stays as typed (same rule as core/telegram/format.ts).
const BOLD = /(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g
const LINK = /<(https?:\/\/[^|\s>]+)(?:\|([^>]+))?>/g

function inline(raw: string): string {
  return raw
    .split(/(`[^`\n]+`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(LINK, (_m, url: string, label?: string) => (label ? `[${label}](${url})` : url))
            .replace(BOLD, '$1**$2**')
    )
    .join('')
}

/** The notifier's text as Discord markdown, cut to DISCORD_TEXT_MAX with an ellipsis. */
export function toDiscordText(text: string): string {
  const out = text
    .split(/(```[\s\S]*?```)/)
    .map((part, i) => (i % 2 === 1 ? part : inline(part)))
    .join('')
  if (out.length <= DISCORD_TEXT_MAX) return out
  let cut = out.slice(0, DISCORD_TEXT_MAX - 1)
  // never leave half of a surrogate pair (an emoji) at the cut
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
  return `${cut}…`
}

/** A channel name Discord accepts: lowercase a-z, 0-9 and `-`, at most 100 characters, never empty
 *  (falls back to `plan`). Accents are dropped (Café → cafe); other scripts and emoji go away. */
export function channelSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CHANNEL_NAME_MAX)
    .replace(/-+$/, '')
  return slug || 'plan'
}
