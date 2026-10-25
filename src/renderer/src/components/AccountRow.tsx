import type { Account, AccountUsage } from '../../../core/types'
import { AccountUsageMeter, AccountUsageDetail, hasUsage } from './AccountUsageMeter'
import { ProviderBadge } from './ProviderBadge'
import { useEffect, useRef, useState } from 'react'
import type { MessageKey } from '../../../core/i18n'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { endRenameOnce } from '../lib/renameOnce'
import { Chip, Icon, IconButton, Input, Menu, menuPointOf, type IconName, type MenuItem } from './ui'
import { accountStatus, type AccountAction, type AccountActionId } from './accountActions'

const ACTION_VIEW: Record<AccountActionId, { label: MessageKey; icon: IconName; danger?: true }> = {
  signIn: { label: 'account.signIn.button', icon: 'login' },
  signInAgain: { label: 'account.signInAgain.button', icon: 'login' },
  signOut: { label: 'account.signOut.button', icon: 'lock' },
  rename: { label: 'account.rename.button', icon: 'edit' },
  switch: { label: 'account.switch.action', icon: 'refresh' },
  merge: { label: 'account.merge.button', icon: 'merge' },
  remove: { label: 'account.remove.button', icon: 'delete', danger: true }
}

/** The ids of the accounts the usage guard has paused (no new worker starts on them). Polled like the plan view's strip;
 *  a missed answer keeps what is drawn. */
export function usePausedIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    let live = true
    const read = (): void => {
      window.api.usage.guard().then(
        (v) => live && setIds(new Set(v.accounts.filter((a) => a.paused !== null).map((a) => a.accountId))),
        () => {}
      )
    }
    read()
    const timer = setInterval(read, 30_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])
  return ids
}

/** Account row UI. Shared by the sidebar and the settings Accounts tab.
 *  The action buttons come in as children — the row does not need to know "who gets which button".
 *  loggedIn and email being undefined is the state before useAccountStatus has queried — handled with a
 *  truthy check. */
export function AccountRow({
  account,
  loggedIn,
  email,
  isDefault,
  usage,
  expanded,
  onToggle,
  actions,
  onAction,
  paused,
  note,
  children
}: {
  account: Account
  loggedIn: boolean | undefined
  email: string | null | undefined
  /** That provider's default account — the ⤓ source. One row per provider can carry it, so with both
   *  claude and codex registered two rows show the badge. */
  isDefault?: boolean
  /** This account's usage, keyed by configDir upstream. undefined draws nothing (design doc §5). */
  usage?: AccountUsage
  /** Is this row's usage detail open. The list owns which one is — only one is open at a time, so
   *  the answer cannot live in the row. */
  expanded?: boolean
  /** Toggle this row's detail. Called on a click or on Enter/Space; the list decides what that
   *  means for the other rows. */
  onToggle?: () => void
  /** What the row's "⋯" and right-click menus offer (accountActions.ts). Given, the menu replaces the separate rename
   *  button. The row handles `rename` itself; every other pick goes to `onAction`. */
  actions?: AccountAction[]
  onAction?: (id: AccountActionId) => void
  /** The usage guard has paused this account. */
  paused?: boolean
  /** A line under the email, e.g. that this account is the same login as another. */
  note?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  // The detail opens on a click, not on hover, so the row is only a control when there is something
  // to open: a logged-out account and one never read both draw nothing, and a row that cannot open
  // must not look or behave as if it could. Provider plays no part — claude and codex rows both carry
  // a reading when their account has one.
  // Renaming the account in place. One rename ends once (audit UI-2), as a tab's does.
  const [renaming, setRenaming] = useState(false)
  const renameEnd = useRef({ ended: null as string | null })
  const saveName = async (raw: string): Promise<void> => {
    setRenaming(false)
    const label = raw.trim()
    if (label === '' || label === account.label) return
    try {
      await window.api.accounts.rename(account.id, label)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const items: MenuItem[] | undefined = actions?.map((a) => {
    const v = ACTION_VIEW[a.id]
    return {
      id: a.id,
      label: a.block === undefined ? t(v.label) : `${t(v.label)} · ${a.block}`,
      icon: <Icon name={v.icon} size={14} />,
      danger: v.danger,
      disabled: a.block !== undefined,
      onSelect: () => (a.id === 'rename' ? setRenaming(true) : onAction?.(a.id))
    }
  })
  const status = accountStatus(loggedIn, Boolean(paused))
  const openable = Boolean(loggedIn) && hasUsage(usage)
  const toggle = openable && onToggle ? onToggle : undefined

  return (
    <li
      className={expanded && openable ? 'acct-row acct-row--open' : 'acct-row'}
      title={email ? `${account.label} · ${email}` : account.configDir}
      onClick={toggle}
      onContextMenu={
        items
          ? (e) => {
              e.preventDefault()
              setCtx(menuPointOf(e))
            }
          : undefined
      }
      // A click needs a keyboard equivalent or the figures are reachable by mouse alone. No
      // role="button": the row already contains real buttons in the settings tab, and nesting
      // buttons inside a button is a worse lie than an unnamed focusable row.
      tabIndex={toggle ? 0 : undefined}
      aria-expanded={toggle ? Boolean(expanded) : undefined}
      onKeyDown={
        toggle
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault() // Space would otherwise scroll the panel
              toggle()
            }
          : undefined
      }
    >
      <span className="acct-mark" style={{ background: account.color }} aria-hidden="true" />
      <div className="acct-id">
        <div className="acct-id__line">
          {/* Double-click the name to rename the account (Enter saves, Escape cancels). */}
          {renaming ? (
            <Input
              className="acct-id__edit"
              autoFocus
              defaultValue={account.label}
              aria-label={t('account.rename.label')}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => {
                renameEnd.current.ended = null
                e.currentTarget.select()
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                const v = e.currentTarget.value
                if (e.key === 'Enter') endRenameOnce(renameEnd.current, account.id, () => void saveName(v))
                else if (e.key === 'Escape') endRenameOnce(renameEnd.current, account.id, () => setRenaming(false))
              }}
              onBlur={(e) => {
                const v = e.currentTarget.value
                endRenameOnce(renameEnd.current, account.id, () => void saveName(v))
              }}
            />
          ) : (
            <span
              className="acct-id__name"
              title={t('account.rename.hint')}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setRenaming(true)
              }}
            >
              {account.label}
            </span>
          )}
          <ProviderBadge provider={account.provider} />
          {isDefault && <Chip>{t('accounts.default')}</Chip>}
          {/* W11: said in words, and only when it is a problem; undefined (not asked yet) draws nothing. */}
          {status === 'signedOut' && <Chip tone="warn" dot>{t('account.status.notLoggedIn')}</Chip>}
          {status === 'paused' && (
            <Chip tone="warn">
              <Icon name="pause" size={14} /> {t('account.status.paused')}
            </Chip>
          )}
        </div>
        {email && <span className="acct-id__email">{email}</span>}
        {note && <span className="acct-id__email acct-id__note" title={note}>{note}</span>}
      </div>
      {/* The actions sit inside the row, so their clicks would bubble into the row's toggle —
          pressing "remove account" would also open the usage detail. Stopped here rather than on
          each button so a caller cannot forget. */}
      <span className="acct-row__actions" onClick={(e) => e.stopPropagation()}>
        {children}
        {!renaming && items && (
          <Menu
            label={t('account.menu.label', { label: account.label })}
            align="end"
            trigger={{ icon: <Icon name="more" size={14} />, variant: 'ghost', size: 'sm' }}
            items={items}
          />
        )}
        {/* Renaming had only a double-click; this is its keyboard and pointer-visible way in. */}
        {!renaming && !items && (
          <IconButton size="sm" icon={<Icon name="edit" size={14} />} label={t('account.rename.button')} onClick={() => setRenaming(true)} />
        )}
      </span>
      {/* Gated on loggedIn as well as on having a reading: §5 draws nothing for an account that is
          not logged in, and `undefined` (the state before useAccountStatus has answered) draws
          nothing either, so no meter flashes in and out on mount. */}
      {loggedIn && <AccountUsageMeter usage={usage} />}
      {ctx && items && <Menu at={ctx} items={items} onClose={() => setCtx(null)} />}
      {/* In flow, after the row's own content, so opening it grows the row downward instead of
          covering the rows beneath (design doc §5.1). */}
      {expanded && openable && <AccountUsageDetail usage={usage} />}
    </li>
  )
}
