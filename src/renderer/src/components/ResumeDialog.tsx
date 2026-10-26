import { useEffect, useState } from 'react'
import type { Account, HistoryEntry, RollConfig, ScheduleConfig, SessionKind } from '../../../core/types'
import { resumeAccountOptions, resumeRollAccountIds } from '../../../core/resume'
import { providerOf } from '../../../core/providers/meta'
import { isSlackReady } from '../../../core/slack/ready'
import { isTelegramReady } from '../../../core/telegram/ready'
import { isDiscordReady } from '../../../core/discord/ready'
import { useI18n } from '../i18n/I18nProvider'
import { useChatAvailability } from '../hooks/useChatAvailability'
import { isGhostAccountId } from '../../../core/accounts/ghostId'
import { AccountDisclosure, AccountSelect } from './AccountSelect'
import { ScheduleFields } from './ScheduleFields'
import { Button, Checkbox, Input, Modal, Tabs } from './ui'
import './sessionDialog.css'

/** Modal for resuming a session from history. Only logged-in accounts appear as candidates; a claude
 *  conversation opens on Auto (most room) with the picker folded, so a full original account is never the
 *  default (main moves a resume off it, carrying the transcript). Picking a different account makes ipc copy the transcript into that
 *  account's configDir before --resume — since slice 4c both 터미널 and 대화 resume this way, so either
 *  kind can run on any candidate the picker offers (resumeChatAllowed).
 *
 *  The rolling, scheduler, Slack and permission checkboxes are settled here. ipc.ts used to quietly
 *  revive the saved rolling and schedule settings (with no way to turn them off) and there was no way
 *  at all to enable Slack. Now the saved values are only the checkbox initial values, and what goes to
 *  spawn is what the user settled on. */
export function ResumeDialog({
  entry,
  cwd,
  accounts,
  ghostAccounts,
  defaultSessionKind,
  onConfirm,
  onCancel
}: {
  entry: HistoryEntry
  cwd: string
  accounts: Account[]
  /** Unregistered sources. Used only to identify the entry's owner — a ghost can never be a candidate,
   *  because resuming needs an account that can authenticate. */
  ghostAccounts: Account[]
  /** Which kind the dialog opens on (the Settings default). Seeds the selection below and nothing
   *  more — picking the other one here belongs to this session and is not written back. */
  defaultSessionKind: SessionKind
  onConfirm: (opts: {
    accountIds: string[] // [0] = the account to continue on, with the chain after it when rolling is on
    kind: SessionKind
    roll: boolean
    rollPrompt?: string
    slackNotify: boolean
    bypassPermissions: boolean
    schedule?: ScheduleConfig
  }) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [options, setOptions] = useState<Account[] | null>(null) // null = login status still being checked
  /** '' is Auto (most room): sent as no account, main ranks the accounts. Only a claude conversation has it —
   *  sessions.spawn ranks claude by default and the resume path has no way to name another provider. */
  const [selectedId, setSelectedId] = useState<string>('')
  const [acctOpen, setAcctOpen] = useState(false)
  // Session kind — terminal (pty) or chat (a Host-owned line process resumed by its protocol thread
  // id — since slice 4c the transcript is copied into the chosen account first, same as terminal, so
  // either kind can land on any candidate the picker offers). Same seeded-and-falls-back rule as
  // NewSessionDialog.
  const [kind, setKind] = useState<SessionKind>(defaultSessionKind)
  // The saved settings — the source of the checkbox initial values and the input to the roll chain calculation
  const [savedRoll, setSavedRoll] = useState<RollConfig | null>(null)
  const [rollOn, setRollOn] = useState(false)
  const [rollPrompt, setRollPrompt] = useState('')
  const [savedSchedule, setSavedSchedule] = useState<ScheduleConfig | null>(null)
  const [schedOn, setSchedOn] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null)
  const [slackNotify, setSlackNotify] = useState(false)
  const [slackReady, setSlackReady] = useState(false)
  const [bypassPermissions, setBypassPermissions] = useState(false)
  const [loadedDefaults, setLoadedDefaults] = useState(false) // mount ScheduleFields only after the prefill

  // The entry's owner, registered or not. undefined means not even detection knows the directory any
  // more (an old entry whose folder is gone) — resume still works on another account.
  const owner = accounts.find((a) => a.id === entry.accountId) ?? ghostAccounts.find((a) => a.id === entry.accountId)
  const ownerGone = owner === undefined || isGhostAccountId(owner.id)
  const autoOk = (owner ? providerOf(owner) : 'claude') === 'claude'

  useEffect(() => {
    let cancelled = false
    // Candidates are only logged-in accounts with the same provider as the original account —
    // resumeAccountOptions does the filtering. Cross-account between codex accounts is supported too,
    // by copying the rollout (the same mechanism as claude, with ipc branching on the path mapping).
    void Promise.all(
      accounts.map(async (a) => [a.id, await window.api.accounts.loginStatus(a.id)] as const)
    ).then((pairs) => {
      if (cancelled) return
      const loggedIn = new Set(pairs.filter(([, ok]) => ok).map(([id]) => id))
      // The owner goes in as an object: an unregistered owner is not in `accounts`, so looking it up by id
      // would fail and the provider would fall back to claude — offering claude accounts for a codex
      // transcript. Only registered accounts are passed as candidates.
      const opts = resumeAccountOptions(accounts, loggedIn, owner)
      setOptions(opts)
      setSelectedId(autoOk ? '' : (opts[0]?.id ?? ''))
    })
    return () => {
      cancelled = true
    }
  }, [accounts, entry.accountId])

  useEffect(() => {
    // The saved rolling and schedule settings become the checkbox initial values. A failed lookup is
    // swallowed — the modal still opens with everything defaulted off. Slack readiness is decided by
    // isSlackReady (looking only at webhookUrl means a user who configured just the bot path cannot
    // turn it on).
    let cancelled = false
    // slackReady means any connection (Slack, Telegram or Discord) is ready; the flag fans out to all of them.
    void Promise.all([window.api.slack.getConfig(), window.api.telegram.getConfig(), window.api.discord.getConfig()]).then(([sl, tg, dc]) => {
      if (!cancelled) setSlackReady(isSlackReady(sl) || isTelegramReady(tg) || isDiscordReady({ ...dc, botToken: dc.hasToken ? 'stored' : null }))
    })
    void window.api.sessions
      .resumeDefaults(entry.sessionId)
      .then((d) => {
        if (cancelled) return
        setSavedRoll(d.roll)
        setRollOn(d.roll !== null)
        setRollPrompt(d.roll?.prompt ?? '')
        setSavedSchedule(d.schedule)
        setSchedOn(d.schedule !== null)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedDefaults(true)
      })
    return () => {
      cancelled = true
    }
  }, [entry.sessionId])

  // Something can start: an account is picked, or Auto has a signed-in account to rank
  const canStart = options !== null && options.length > 0 && (selectedId !== '' || autoOk)
  const crossAccount = selectedId !== '' && selectedId !== entry.accountId
  // The chain that actually goes to spawn — the display uses this value too (the result after the provider filter and the rotation reorder)
  const rollChain = selectedId ? resumeRollAccountIds(savedRoll?.accountIds ?? null, accounts, selectedId) : []
  const labelOf = (id: string): string => accounts.find((a) => a.id === id)?.label ?? id
  const picker = options && (
    <AccountSelect
      accounts={options}
      value={selectedId}
      onChange={setSelectedId}
      {...(autoOk ? { allLabel: t('accounts.auto') } : {})}
      suffixOf={(a) => (a.id === entry.accountId ? t('session.resume.originalAccountSuffix') : null)}
    />
  )

  // The Host poll is shared with NewSessionDialog; either provider's account can open a chat session.
  const { enabled: chatEnabled, checking: chatChecking } = useChatAvailability()
  // Resuming one is no narrower than starting one any more (resumeChatAllowed) — the chat spawn path
  // copies the transcript into the chosen account too, so any candidate the picker offers works.
  const chatAllowed = chatEnabled && canStart
  // A remembered 대화 falls back to 터미널 while it is unavailable — never persisted, so it is offered
  // again once the condition clears (same reasoning as NewSessionDialog's own fallback effect). Picking
  // another account is one of those conditions: the choice comes back the moment the owner is picked
  // again, which is why the fallback is state here and never written back to the setting.
  // Two things here are unknown for the first moment rather than false: whether the Host can run 대화
  // at all (chatChecking), and whether an account can start it — `options` is null until the login probe
  // answers, which alone makes chatAllowed false. Acting on either
  // before it is known threw the seeded 대화 selection away and never put it back. Same defect as
  // NewSessionDialog's, with one more source of "not yet".
  useEffect(() => {
    if (kind === 'chat' && !chatAllowed && !chatChecking && options !== null) setKind('terminal')
  }, [kind, chatAllowed, chatChecking, options])

  const confirm = (): void => {
    if (!canStart) return
    onConfirm({
      // Auto sends no account: main picks the best and rolls over the ranking
      accountIds: !selectedId ? [] : rollOn ? rollChain : [selectedId],
      kind,
      roll: rollOn,
      rollPrompt: rollOn ? rollPrompt.trim() || undefined : undefined,
      slackNotify: slackReady && slackNotify,
      bypassPermissions,
      schedule: schedOn ? (schedule ?? undefined) : undefined
    })
  }

  return (
    <Modal
      title={t('session.resume.title')}
      onClose={onCancel}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!canStart || (schedOn && !schedule)} onClick={confirm}>
            {t('session.resume.confirm')}
          </Button>
        </>
      }
    >
      <div className="sd-body">
        {/* Heads the form as its own ruled-off section, as in NewSessionDialog: the way the resumed
            session runs is decided before the conversation, folder and account it applies to. */}
        <div className="sd-group sd-group--ruled">
          <span className="sd-label">{t('session.new.kindLabel')}</span>
          <Tabs
            variant="segmented"
            label={t('session.new.kindLabel')}
            value={kind}
            onChange={setKind}
            items={[
              { id: 'terminal', label: t('session.kind.terminal') },
              { id: 'chat', label: t('session.kind.chat'), disabled: !chatAllowed }
            ]}
          />
          {!chatEnabled && !chatChecking && (
            <span className="kind-note">{t('overlays.session.kindServiceOld')}</span>
          )}
        </div>
        <div className="sd-group">
          <span className="sd-label">{t('session.resume.conversationLabel')}</span>
          <span className="path">{entry.title}</span>
        </div>
        <div className="sd-group">
          <span className="sd-label">{t('session.field.projectFolder')}</span>
          <span className="path">{cwd}</span>
        </div>
        {/* Only when the owning account is gone. With it alive the picker lists it with the
            '(original account)' suffix, so a second row would just repeat that. */}
        {ownerGone && (
          <div className="sd-group">
            <span className="sd-label">{t('session.resume.originAccount')}</span>
            <span className="path">
              {owner?.label ?? entry.accountId}
              <em className="origin-deleted">{t('session.resume.originDeleted')}</em>
            </span>
          </div>
        )}
        <div className="sd-group">
          <span className="sd-label">{t('session.field.account')}</span>
          {options === null ? (
            <span className="check-note">{t('session.resume.checkingLogin')}</span>
          ) : options.length === 0 ? (
            <span className="sd-warn">{t('session.resume.noLoggedInAccounts')}</span>
          ) : autoOk ? (
            <AccountDisclosure
              id="resume-accounts"
              open={acctOpen}
              onToggle={() => setAcctOpen((v) => !v)}
              summary={selectedId ? labelOf(selectedId) : t('accounts.auto')}
            >
              {picker}
            </AccountDisclosure>
          ) : (
            picker
          )}
          {crossAccount && (
            <span className="roll-prompt-hint">{t('session.resume.crossAccountHint')}</span>
          )}
        </div>
        {/* Rolling now applies to 대화 too (slice 4c) — see NewSessionDialog's own note. */}
        <Checkbox checked={rollOn} onChange={(v) => setRollOn(v)} label={t('session.new.rollLabel')} />
        {rollOn && (
          <div className="roll-prompt-field">
            <Input
              className="roll-prompt-input"
              value={rollPrompt}
              maxLength={500}
              placeholder={t('session.new.rollPromptPlaceholder')}
              onChange={(e) => setRollPrompt(e.target.value)}
            />
            <span className="roll-prompt-hint">{t('session.new.rollPromptHint')}</span>
            {rollChain.length >= 2 && (
              <span className="roll-prompt-hint">
                {t('session.resume.rollChainHint', { chain: rollChain.map(labelOf).join(' → ') })}
              </span>
            )}
          </div>
        )}
        {/* The label follows the field below it — see NewSessionDialog's own note. */}
        <Checkbox
          checked={schedOn}
          onChange={(v) => setSchedOn(v)}
          label={t(kind === 'chat' ? 'session.new.schedLabelChat' : 'session.new.schedLabel')}
        />
        {/* Mounted only after the saved-value lookup finishes — ScheduleFields reads initial exactly
            once, at mount. schedule ?? savedSchedule: on a toggle off and back on, a value the user
            already edited (schedule) is restored first, and before any edit it is filled from the saved
            value (savedSchedule). schedule only ever holds the last value that was valid (an
            intermediate state with an empty command sends null from onChange and is not recorded), so
            that limitation carries over here as well. */}
        {schedOn && loadedDefaults && (
          <ScheduleFields initial={schedule ?? savedSchedule} onChange={setSchedule} chat={kind === 'chat'} />
        )}
        <Checkbox
          checked={slackReady && slackNotify}
          disabled={!slackReady}
          onChange={(v) => setSlackNotify(v)}
          label={
            <>
              {t('session.new.slackNotify')}
              {!slackReady && <span className="check-note">{t('session.new.slackNeedsWebhook')}</span>}
            </>
          }
        />
        <Checkbox
          checked={bypassPermissions}
          onChange={(v) => setBypassPermissions(v)}
          label={t('session.new.bypassPermissions')}
        />
      </div>
    </Modal>
  )
}
