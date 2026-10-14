/** A resume or reset time as the app shows it: HH:MM for the 5-hour window, M/D HH:MM for the weekly one (the same
 *  distinction as the TerminalView banner), in this machine's local time. The Slack notifier and plugin notifications
 *  (plugin Phase 3) say it the same way. */
export function resumeAtText(atMs: number, weekly: boolean): string {
  const d = new Date(atMs)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return weekly ? `${d.getMonth() + 1}/${d.getDate()} ${hm}` : hm
}
