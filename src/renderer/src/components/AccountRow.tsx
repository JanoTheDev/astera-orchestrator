import type { Account, AccountPlan, AccountUsage } from '../../../core/types'
import { providerOf } from '../../../core/providers/meta'
import { AccountUsageMeter, AccountUsageDetail, hasUsage } from './AccountUsageMeter'
import { ProviderBadge } from './ProviderBadge'
import { useEffect, useRef, useState } from 'react'
import type { MessageKey } from '../../../core/i18n'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { endRenameOnce } from '../lib/renameOnce'
import { useActiveSession } from '../lib/activeSession'
import type { useAccountStatus } from '../hooks/useAccountStatus'
import { useAccountUsage } from '../hooks/useAccountUsage'
import { useAccountPlans } from '../hooks/useAccountPlans'
import { activeAccountOf } from './shell/shellView'
import { Button, Chip, Icon, IconButton, Input, Menu, menuPointOf, type ChipTone, type IconName, type MenuItem } from './ui'
import {
  accountActions,
  accountStatus,
  planLabelOf,
  signInButtonOf,
  type AccountAction,
  type AccountActionId,
  type AccountLoginFact,
  type AccountStatus
} from './accountActions'
import { hasSessionWindow } from './sessionWindow'

const ACTION_VIEW: Record<AccountActionId, { label: MessageKey; icon: IconName; danger?: true }> = {
  signIn: { label: 'account.signIn.button', icon: 'login' },
  signInAgain: { label: 'account.signInAgain.button', icon: 'login' },
  signOut: { label: 'account.signOut.button', icon: 'lock' },
  rename: { label: 'account.rename.button', icon: 'edit' },
  switch: { label: 'account.switch.action', icon: 'refresh' },
  merge: { label: 'account.merge.button', icon: 'merge' },
  remove: { label: 'account.remove.button', icon: 'delete', danger: true }
}

/** T4: the state chip of each login state, and paused. Every one carries a word and an icon, so colour is never the only
 *  cue; `hint` is the hover title where the word alone does not say what to do. */
const STATUS_VIEW: Record<AccountStatus, { label: MessageKey; icon: IconName; tone: ChipTone; hint?: MessageKey }> = {
  signedIn: { label: 'account.status.signedIn', icon: 'done', tone: 'ok' },
  signedOut: { label: 'account.status.signedOut', icon: 'lock', tone: 'warn' },
  expired: { label: 'account.status.expired', icon: 'warning', tone: 'danger', hint: 'account.status.expiredHint' },
  unknown: { label: 'account.status.unknown', icon: 'info', tone: 'neutral', hint: 'account.status.unknownHint' },
  paused: { label: 'account.status.paused', icon: 'pause', tone: 'warn' }
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

/** Account row UI. Shared by the activity bar's popover and Settings › Accounts & usage (through AccountList).
 *
 *  Three lines (T4): identity (colour mark, name, provider, plan chip, state chip), then the email with the Default and
 *  Active marks, then usage. Extra buttons come in as children: the row does not need to know "who gets which button".
 *  loggedIn and email being undefined is the state before useAccountStatus has answered: nothing is drawn for them. */
export function AccountRow({
  account,
  loggedIn,
  email,
  plan,
  isDefault,
  active,
  activeHint,
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
  /** The login as useAccountStatus holds it: its full state, or the older boolean. */
  loggedIn: AccountLoginFact
  email: string | null | undefined
  /** The account's subscription plan (useAccountPlans): drawn as a chip, and Ultra draws no 5-hour track. */
  plan?: AccountPlan
  /** That provider's default account, the ⤓ source. One row per provider can carry it, so with both
   *  claude and codex registered two rows show the mark. */
  isDefault?: boolean
  /** The active account: the one the open tab runs on, else the one the status bar shows (shellView activeAccountOf). */
  active?: boolean
  /** Hover title of the Active mark: which of the two it is. */
  activeHint?: string
  /** This account's usage, keyed by configDir upstream. undefined draws nothing (design doc §5). */
  usage?: AccountUsage
  /** Is this row's usage detail open. The list owns which one is: only one is open at a time, so
   *  the answer cannot live in the row. */
  expanded?: boolean
  /** Toggle this row's detail. Called on a click or on Enter/Space; the list decides what that
   *  means for the other rows. */
  onToggle?: () => void
  /** What the row's "⋯" and right-click menus offer (accountActions.ts). Given, the menu replaces the separate rename
   *  button. The row handles `rename` itself; every other pick goes to `onAction`, as does the inline sign-in button. */
  actions?: AccountAction[]
  onAction?: (id: AccountActionId) => void
  /** The usage guard has paused this account. */
  paused?: boolean
  /** A line under the email, e.g. that this account is the same login as another. */
  note?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
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
  const statusView = status ? STATUS_VIEW[status] : null
  const signedIn = loggedIn === true || loggedIn === 'signedIn'
  // W7-F (#82): sign in from the row itself, when the login is known to need it (not before the check has answered).
  const signInId = onAction ? signInButtonOf(loggedIn) : null
  const planLabel = planLabelOf(plan, t)
  const sessionWindow = hasSessionWindow(plan, usage)
  // The detail opens on a click, not on hover, so the row is only a control when there is something
  // to open: a logged-out account and one never read both draw nothing, and a row that cannot open
  // must not look or behave as if it could.
  const openable = signedIn && hasUsage(usage)
  const toggle = openable && onToggle ? onToggle : undefined
  const cls = ['acct-row', active && 'acct-row--active', expanded && openable && 'acct-row--open'].filter(Boolean).join(' ')

  return (
    <li
      className={cls}
      aria-current={active ? 'true' : undefined}
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
      // role="button": the row already contains real buttons, and nesting buttons inside a
      // button is a worse lie than an unnamed focusable row.
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
          {/* T4: the plan by name, or the raw string of one not recognised; nothing when nothing was read. */}
          {planLabel && (
            <span className="acct-plan" title={t('account.plan.title', { plan: planLabel })}>
              <Chip className="acct-plan__chip">{planLabel}</Chip>
            </span>
          )}
          {statusView && (
            <span className="acct-state" title={statusView.hint ? t(statusView.hint) : undefined}>
              <Chip tone={statusView.tone} className="acct-state__chip">
                <Icon name={statusView.icon} size={14} />
                {t(statusView.label)}
              </Chip>
            </span>
          )}
        </div>
        {(email || isDefault || active) && (
          <div className="acct-id__meta">
            {email && <span className="acct-id__email">{email}</span>}
            {isDefault && <span className="acct-tag">{t('accounts.default')}</span>}
            {active && (
              <span className="acct-tag acct-tag--active" title={activeHint}>
                <Icon name="active" size={14} />
                {t('account.active')}
              </span>
            )}
          </div>
        )}
        {note && <span className="acct-id__note" title={note}>{note}</span>}
      </div>
      {/* The actions sit inside the row, so their clicks would bubble into the row's toggle:
          pressing "remove account" would also open the usage detail. Stopped here rather than on
          each button so a caller cannot forget. */}
      <span className="acct-row__actions" onClick={(e) => e.stopPropagation()}>
        {signInId && !renaming && (
          <Button size="sm" variant="ghost" icon={<Icon name="login" size={14} />} onClick={() => onAction?.(signInId)}>
            {t(ACTION_VIEW[signInId].label)}
          </Button>
        )}
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
      {/* Gated on a signed-in login as well as on having a reading: §5 draws nothing for an account that is
          not logged in, and `undefined` (the state before useAccountStatus has answered) draws
          nothing either, so no meter flashes in and out on mount. */}
      {signedIn && <AccountUsageMeter usage={usage} sessionWindow={sessionWindow} />}
      {ctx && items && <Menu at={ctx} items={items} onClose={() => setCtx(null)} />}
      {/* In flow, after the row's own content, so opening it grows the row downward instead of
          covering the rows beneath (design doc §5.1). */}
      {expanded && openable && <AccountUsageDetail usage={usage} sessionWindow={sessionWindow} />}
    </li>
  )
}

/** T4: the account list both surfaces draw, so the popover and Settings show the same rows from the same sources:
 *  login state from the window-wide store (`status`, the caller's useAccountStatus), usage, plans, the guard's pauses
 *  and the active account. The caller adds per-row extras (Settings' "Import settings") and notes (a duplicate login). */
export function AccountList({
  accounts,
  status,
  switchBlock,
  onAction,
  mergeableOf,
  noteOf,
  extraOf
}: {
  accounts: Account[]
  status: ReturnType<typeof useAccountStatus>
  switchBlock: (a: Account) => string | null | undefined
  onAction: (a: Account, id: AccountActionId) => void
  mergeableOf?: (a: Account) => boolean
  noteOf?: (a: Account) => string | undefined
  extraOf?: (a: Account) => React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  const usage = useAccountUsage()
  const plans = useAccountPlans(accounts)
  const paused = usePausedIds()
  // The status bar's account (useShell): the open tab's, else the first one. Marking the same one keeps the two in step.
  const tab = useActiveSession()
  const activeId = activeAccountOf(accounts, tab?.accountId)?.id
  const tabHasIt = tab !== null && tab.accountId === activeId
  // Which row has its usage detail open. One at a time, so the answer belongs to the list rather than to each row.
  // Keyed by account id: configDir can be shared by two accounts.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { loginStates, emailMap, defaultIdByProvider } = status
  return (
    <ul className="acct-list">
      {accounts.map((a) => (
        <AccountRow
          key={a.id}
          account={a}
          loggedIn={loginStates[a.id]}
          email={emailMap[a.id]}
          plan={plans[a.id]}
          isDefault={defaultIdByProvider[providerOf(a)] === a.id}
          active={a.id === activeId}
          activeHint={t(tabHasIt ? 'account.active.hintTab' : 'account.active.hintStatusBar')}
          usage={usage[a.configDir]}
          note={noteOf?.(a)}
          expanded={expandedId === a.id}
          onToggle={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
          actions={accountActions({ loggedIn: loginStates[a.id], switchBlock: switchBlock(a), mergeable: mergeableOf?.(a) ?? false })}
          onAction={(id) => onAction(a, id)}
          paused={paused.has(a.id)}
        >
          {extraOf?.(a)}
        </AccountRow>
      ))}
    </ul>
  )
}
