/** A resume or reset time as the app shows it: HH:MM for the 5-hour window, the day and HH:MM for the weekly one (the
 *  same distinction as the TerminalView banner), in this machine's local time. The day is M/D, as the Slack notifier
 *  says it, or in the order `lang` reads a day and month (plugin notifications, 3c final review M8: 3/4 is the 3rd of
 *  April to a Spanish reader). */
export function resumeAtText(atMs: number, weekly: boolean, lang?: string): string {
  const d = new Date(atMs)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (!weekly) return hm
  const day = lang === undefined ? `${d.getMonth() + 1}/${d.getDate()}` : new Intl.DateTimeFormat(lang, { month: 'numeric', day: 'numeric' }).format(d)
  return `${day} ${hm}`
}
