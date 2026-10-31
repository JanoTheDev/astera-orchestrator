import { useMemo } from 'react'
import type { Account } from '../../../core/types'
import { useAccountStatus } from '../hooks/useAccountStatus'
import { useAccountUsage } from '../hooks/useAccountUsage'
import { useAccountPlans } from '../hooks/useAccountPlans'
import { useI18n } from '../i18n/I18nProvider'
import { accountSelectItems } from './accountSelectItems'
import { ProviderBadge } from './ProviderBadge'
import { Button, Icon, Select, type SelectOption } from './ui'
import './sessionDialog.css'

const NO_ACCOUNTS: Account[] = [] // stable identity: useAccountStatus re-queries when its argument changes

/** Account picker. A thin wrapper over Select: each row shows the account colour dot and provider badge as
 *  its icon, and 5h/week usage (week alone without a 5-hour window) or "signed out" at the right edge (account.select.*).
 *
 *  The props stay backward-compatible with every earlier call site — account selection runs through session
 *  spawning, resume and rolling, and a signature change there is the kind of churn that hides a regression.
 *  `loginMap` is for accounts the local hooks cannot answer for (a remote machine's list): when given it
 *  replaces the local login probe, and those accounts carry an empty configDir so no local usage matches.
 *
 *  noCheck: the Claude/Codex badge already identifies the row, so a trailing check would put two marks in
 *  competition. Selection shows in the label colour, as it did before. */
export function AccountSelect({
  accounts,
  value,
  onChange,
  allLabel,
  suffixOf,
  className,
  loginMap: givenLoginMap,
  disabled,
  ariaLabel
}: {
  accounts: Account[]
  value: string
  onChange: (id: string) => void
  /** When given, puts an 'All accounts' item with the value '' at the very front (the history account filter) */
  allLabel?: string
  /** Secondary text after the label (e.g. resume's ' (original account)') */
  suffixOf?: (a: Account) => string | null
  className?: string
  loginMap?: Record<string, boolean>
  disabled?: boolean
  ariaLabel?: string
}): React.JSX.Element {
  const { t } = useI18n()
  // Status is queried per mount (on mount and window focus, no timer); usage is one ref-counted main-side subscription.
  const local = useAccountStatus(givenLoginMap ? NO_ACCOUNTS : accounts)
  const usage = useAccountUsage()
  // T4: an Ultra account shows its weekly figure alone (sessionWindow.ts). A remote list has no local plan to read.
  const plans = useAccountPlans(givenLoginMap ? NO_ACCOUNTS : accounts)
  const loginMap = givenLoginMap ?? local.loginMap
  const items: SelectOption[] = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]))
    return accountSelectItems({ accounts, loginMap, usage, t, plans, allLabel, suffixOf }).map((it) => {
      const a = byId.get(it.value)
      // No icon on the all-item, which is why Select reserves the icon column across the whole list
      if (!a) return it
      return {
        ...it,
        icon: (
          <span className="acct-opt-icon">
            {a.color && <span className="acct-opt-dot" style={{ background: a.color }} />}
            <ProviderBadge provider={a.provider} />
          </span>
        )
      }
    })
  }, [accounts, loginMap, usage, plans, t, allLabel, suffixOf])
  return <Select items={items} value={value} onChange={onChange} className={className} disabled={disabled} ariaLabel={ariaLabel} noCheck />
}

/** The folded "Choose account" area every start dialog puts its account control in: Auto (most room) is the default
 *  and the control opens only to pin an account (StartPage's "More options" pattern). The caller owns `open`, since
 *  a pinned default may open it by itself. */
export function AccountDisclosure({
  id,
  open,
  onToggle,
  summary,
  children
}: {
  id: string
  open: boolean
  onToggle: () => void
  /** What applies while it is folded (Auto, or the pinned account's name) */
  summary?: string
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <>
      <div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />}
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
        >
          {t('overlays.account.choose')}
        </Button>
        {!open && summary && <span className="sd-hint">{summary}</span>}
      </div>
      {open && <div id={id}>{children}</div>}
    </>
  )
}
