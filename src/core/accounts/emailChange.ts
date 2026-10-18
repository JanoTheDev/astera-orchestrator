// W7-F (#77): a config folder re-logged as another person (`claude /login` in `~/.claude`) is that person's now.
// Each login check reads the folder's email; when it differs from the one last seen, the row follows it: the label
// becomes the new email unless the owner renamed the account, and the old usage reading is dropped by the caller.
import type { Account } from '../types'

/** What to write back for this reading, or null when nothing changes. `switched` is true when the folder now belongs to
 *  someone else: an email seen before differs, or, at the first reading, an email-shaped label differs. */
export function emailChangeOf(
  account: Pick<Account, 'label' | 'email'>,
  email: string | null
): { label: string; email: string; switched: boolean } | null {
  if (!email || email === account.email) return null
  // First check of this account (none recorded yet, e.g. a folder re-logged before this was built): a label that is an
  // email address came from the folder, so a different one means the folder changed hands.
  if (account.email === undefined) {
    const stale = account.label.includes('@') && account.label !== email
    return { label: stale ? email : account.label, email, switched: stale }
  }
  // A label equal to the old email was never chosen by the owner, so it follows the folder.
  return { label: account.label === account.email ? email : account.label, email, switched: true }
}
