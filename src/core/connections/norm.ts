// Shared by every connection's config reader/store (Slack, Telegram): a stored setting is a trimmed
// non-empty string or null, so "" and "   " read as "not set". Node-free.
export const norm = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null
