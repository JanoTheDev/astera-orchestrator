// W7-F (#77): a config folder re-logged as another person (`claude /login` in `~/.claude`) is that person's now.
// Each login check reads the folder's email; when it differs from the one last seen, the row follows it: the label
// becomes the new email unless the owner renamed the account, and the old usage reading is dropped by the caller.
import type { Account } from '../types'

/** What to write back for this reading, or null when nothing changes. `switched` is true only when an email was seen
 *  before and this one differs: the first reading of an account only records it. */
export function emailChangeOf(
  account: Pick<Account, 'label' | 'email'>,
  email: string | null
): { label: string; email: string; switched: boolean } | null {
  if (!email || email === account.email) return null
  if (account.email === undefined) return { label: account.label, email, switched: false }
  // A label equal to the old email was never chosen by the owner, so it follows the folder.
  return { label: account.label === account.email ? email : account.label, email, switched: true }
}
