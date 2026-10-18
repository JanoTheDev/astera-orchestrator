// W9-D: shows the Inbox page over the window until W9-B's page switch mounts InboxPage as the `inbox` page. Opened by
// `openInbox()` (inboxNav.ts). When B's switch renders the page, this host (and its line in Overlays) goes.
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from '../ui'
import { InboxPage } from './InboxPage'
import { closeInbox, useInboxRequest } from './inboxNav'

export function InboxHost(props: React.ComponentProps<typeof InboxPage>): React.JSX.Element | null {
  const { open } = useInboxRequest()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeInbox()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  return (
    <div className="inbox-host" role="dialog" aria-label="Inbox">
      <Button className="inbox-host__close" icon={<X size={16} />} aria-label="Close the Inbox" onClick={closeInbox} />
      <InboxPage {...props} />
    </div>
  )
}
