// The first-run onboarding (DESIGN-W11): one full-window page, step by step — Welcome, Tools, Accounts, First
// project, Preferences, Done. The rules live in onboardingModel.ts; this draws them. Choices are saved as they are
// made (the same setters Settings uses), so leaving at any step keeps what was set.
import { useEffect, useRef, useState } from 'react'
import type { Account, CliStatus, DetectCandidate, Provider, SessionKind, UpdateMode, UpdateStatus } from '../../../../core/types'
import type { Lang } from '../../../../core/i18n'
import { CATALOGS, LANGS } from '../../../../core/i18n'
import { PROVIDER_META } from '../../../../core/providers/meta'
import { modeHintKey } from '../../../../core/update/sourceView'
import { useI18n } from '../../i18n/I18nProvider'
import { useAccountStatus } from '../../hooks/useAccountStatus'
import { toast } from '../../lib/toast'
import { CliInstallCards } from '../CliInstallRows'
import { AccountSignInDialog } from '../AccountSignIn'
import { ProviderBadge } from '../ProviderBadge'
import { Button, Card, Chip, Field, Icon, Select, type SelectOption } from '../ui'
import logoUrl from '../../assets/mark.svg'
import {
  ONBOARDING_STEPS, canNext, canSkipStep, donePrimary, doneNotes, nextStep, prevStep, resumeStep, showUpdateChoice, stepIndex,
  type OnboardingExit, type OnboardingStep
} from './onboardingModel'
import { onboardingReplayStart } from './replay'
import './onboarding.css'
import { FOCUSABLE, modalKeyAction } from '../ui/logic'

const UPDATE_MODES: readonly UpdateMode[] = ['off', 'notify', 'build', 'install-when-idle']
/** Same convention as GeneralSettings: Select keys rows by string, so "System" is the empty string. */
const SYSTEM_LANG = ''

const KINDS = ['terminal', 'chat'] as const

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

export interface OnboardingProps {
  /** Opened from Settings: starts at Welcome and does not record a step (it is not a first run). */
  replay: boolean
  cli: { claude: CliStatus; codex: CliStatus } | null
  cliInstalled: { claude: boolean; codex: boolean } | null
  onCliInstalled: (installed: { claude: boolean; codex: boolean }) => void
  accounts: Account[]
  currentProject: string | null
  /** Opens the add-project dialog; undefined when there is no Host to ask yet. */
  onAddProject?: () => void
  defaultSessionKind: SessionKind
  setDefaultSessionKind: (kind: SessionKind) => void
  update: UpdateStatus | null
  onExit: (exit: OnboardingExit) => void
}

export function Onboarding(p: OnboardingProps): React.JSX.Element | null {
  const { t, storedLang, systemLang, setLang } = useI18n()
  // null until a first run's stored step is read, so it never flashes Welcome before jumping on.
  const [step, setStep] = useState<OnboardingStep | null>(p.replay ? onboardingReplayStart() : null)
  const [updateMode, setUpdateMode] = useState<UpdateMode | null>(null)
  const [tools, setTools] = useState<{ git: boolean; gh: boolean } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const cliFound = !!p.cliInstalled && (p.cliInstalled.claude || p.cliInstalled.codex)
  const updateChoice = showUpdateChoice(p.update)

  useEffect(() => {
    if (p.replay) return
    void window.api.settings
      .getOnboardingStep()
      .then((s) => setStep(resumeStep(s)))
      .catch(() => setStep('welcome'))
  }, [p.replay])
  useEffect(() => {
    void window.api.system.checkTools().then(setTools).catch(() => setTools(null))
  }, [])
  useEffect(() => {
    void window.api.settings.getUpdateMode().then(setUpdateMode).catch(() => {})
  }, [])
  useEffect(() => {
    if (step === null) return
    heading.current?.focus()
    if (!p.replay) void window.api.settings.setOnboardingStep(step).catch(() => {})
  }, [step, p.replay])

  if (step === null) return <div className="onb" />

  const go = (s: OnboardingStep): void => setStep(s)
  const enabled = canNext(step, { cliFound, accountCount: p.accounts.length })

  const pickKind = (kind: SessionKind): void => {
    const prev = p.defaultSessionKind
    p.setDefaultSessionKind(kind)
    void window.api.settings.setDefaultSessionKind(kind).catch((err) => {
      p.setDefaultSessionKind(prev)
      toast.error(t('settings.defaultKind.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }
  const pickMode = (mode: UpdateMode): void => {
    const prev = updateMode
    setUpdateMode(mode)
    void window.api.settings.setUpdateMode(mode).catch((err) => {
      setUpdateMode(prev)
      toast.error(t('update.ui.modeSaveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  const langItems: SelectOption[] = [
    { value: SYSTEM_LANG, label: t('settings.general.language.system', { lang: CATALOGS[systemLang].nativeName }) },
    ...LANGS.map((l) => ({ value: l, label: CATALOGS[l].nativeName }))
  ]
  // Radio group keyboard: arrows move the choice and its focus together (roving tabindex), like Tabs.
  const kindKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = KINDS[(KINDS.indexOf(p.defaultSessionKind) + d + KINDS.length) % KINDS.length]
    pickKind(next)
    e.currentTarget.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus()
  }

  const title = (key: Parameters<typeof t>[0]): React.JSX.Element => (
    <h1 ref={heading} tabIndex={-1} className="onb__title">
      {t(key)}
    </h1>
  )

  let body: React.ReactNode
  let actions: React.ReactNode
  const nextButton = (
    <Button variant="primary" size="lg" disabled={!enabled} onClick={() => go(nextStep(step))}>
      {t('onboarding.next')}
    </Button>
  )
  // Tools and Accounts wait on something the person may not be able to do yet: they can always go on without it.
  const skipButton =
    canSkipStep(step) && !enabled ? (
      <Button size="lg" onClick={() => go(nextStep(step))}>
        {t('onboarding.skipStep')}
      </Button>
    ) : null

  if (step === 'welcome') {
    body = (
      <>
        <img className="onb__mark" src={logoUrl} alt="" width={48} height={48} />
        {title('onboarding.welcome.title')}
        <p className="onb__lead">{t('onboarding.welcome.body')}</p>
        <label className="onb__lang">
          <span>{t('settings.general.language')}</span>
          <Select
            items={langItems}
            value={storedLang ?? SYSTEM_LANG}
            onChange={(v) => setLang(v === SYSTEM_LANG ? null : (v as Lang))}
            ariaLabel={t('settings.general.language')}
          />
        </label>
      </>
    )
    actions = (
      <Button variant="primary" size="lg" onClick={() => go('tools')}>
        {t('onboarding.welcome.start')}
      </Button>
    )
  } else if (step === 'tools') {
    body = (
      <>
        {title('onboarding.tools.title')}
        <p className="onb__lead">{t('onboarding.tools.body')}</p>
        <Card className="onb__card onb__rows">
          <CliInstallCards cli={p.cliInstalled} onInstalled={p.onCliInstalled} />
        </Card>
        <Status ok={cliFound} text={cliFound ? t('onboarding.tools.ready') : t('onboarding.tools.none')} />
        {tools && (
          <Card className="onb__card onb__list">
            <div className="onb__row">
              <Status ok={tools.git} text={t(tools.git ? 'onboarding.tools.git.ok' : 'onboarding.tools.git.missing')} />
            </div>
            <div className="onb__row">
              <Status ok={tools.gh} text={t(tools.gh ? 'onboarding.tools.gh.ok' : 'onboarding.tools.gh.missing')} />
            </div>
          </Card>
        )}
      </>
    )
    actions = (
      <>
        {skipButton}
        {nextButton}
      </>
    )
  } else if (step === 'accounts') {
    body = (
      <>
        {title('onboarding.accounts.title')}
        <p className="onb__lead">{t('onboarding.accounts.body')}</p>
        {!cliFound && <p className="onb__dim">{t('onboarding.accounts.needCli')}</p>}
        <AccountsStep accounts={p.accounts} cliInstalled={p.cliInstalled} />
      </>
    )
    actions = (
      <>
        {skipButton}
        {nextButton}
      </>
    )
  } else if (step === 'project') {
    body = (
      <>
        {title('onboarding.project.title')}
        <p className="onb__lead">{t('onboarding.project.body')}</p>
        <Card className="onb__card onb__row">
          <span className="onb__row-main">
            {p.currentProject ? (
              <Status ok text={t('onboarding.project.current', { name: baseName(p.currentProject) })} />
            ) : (
              <span className="onb__dim">{t('onboarding.project.none')}</span>
            )}
          </span>
          <Button icon={<Icon name="folder" />} disabled={!p.onAddProject} onClick={p.onAddProject}>
            {t('onboarding.project.pick')}
          </Button>
        </Card>
      </>
    )
    actions = nextButton
  } else if (step === 'preferences') {
    body = (
      <>
        {title('onboarding.prefs.title')}
        <p className="onb__lead">{t('onboarding.prefs.body')}</p>
        <div className="onb__label">{t('settings.defaultKind.title')}</div>
        <div className="onb__choices" role="radiogroup" aria-label={t('settings.defaultKind.title')} onKeyDown={kindKeyDown}>
          {KINDS.map((kind) => (
            <Card
              key={kind}
              tone={p.defaultSessionKind === kind ? 'focus' : 'plain'}
              role="radio"
              aria-checked={p.defaultSessionKind === kind}
              tabIndex={p.defaultSessionKind === kind ? 0 : -1}
              data-kind={kind}
              onClick={() => pickKind(kind)}
              className="onb__choice"
            >
              <span className="onb__choice-name">
                <Icon name={p.defaultSessionKind === kind ? 'check' : 'pending'} />
                {t(kind === 'terminal' ? 'settings.defaultKind.terminal' : 'settings.defaultKind.chat')}
              </span>
              <span className="onb__dim">{t(kind === 'terminal' ? 'onboarding.prefs.terminalWhat' : 'onboarding.prefs.chatWhat')}</span>
            </Card>
          ))}
        </div>
        {updateChoice && updateMode !== null && (
          <Field
            kind="select"
            label={t('update.ui.mode')}
            hint={t(modeHintKey(updateMode))}
            value={updateMode}
            options={UPDATE_MODES.map((m) => ({ value: m, label: t(`update.ui.mode.${m}`) }))}
            onChange={(e) => pickMode(e.target.value as UpdateMode)}
          />
        )}
      </>
    )
    actions = nextButton
  } else {
    const clis = [p.cliInstalled?.claude && 'Claude Code', p.cliInstalled?.codex && 'Codex'].filter(Boolean).join(', ')
    const rows: Array<[string, string]> = [
      [t('onboarding.done.tools'), clis || t('onboarding.done.none')],
      [t('onboarding.done.accounts'), String(p.accounts.length)],
      [t('onboarding.done.project'), p.currentProject ? baseName(p.currentProject) : t('onboarding.done.none')],
      [t('settings.defaultKind.title'), t(p.defaultSessionKind === 'chat' ? 'settings.defaultKind.chat' : 'settings.defaultKind.terminal')]
    ]
    if (updateChoice && updateMode !== null) rows.push([t('update.ui.mode'), t(`update.ui.mode.${updateMode}`)])
    body = (
      <>
        {title('onboarding.done.title')}
        <p className="onb__lead">{t('onboarding.done.body')}</p>
        {doneNotes({ cliFound, accountCount: p.accounts.length }).map((n) => (
          <Status key={n} ok={false} text={t(n === 'noCli' ? 'onboarding.done.needCli' : 'onboarding.done.noAccount')} />
        ))}
        <Card className="onb__card">
          <dl className="onb__summary">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </>
    )
    actions = (
      <>
        <Button size="lg" onClick={() => p.onExit('agents')}>
          {t('onboarding.done.agents')}
        </Button>
        {donePrimary({ cliFound }) === 'start' ? (
          <Button variant="primary" size="lg" onClick={() => p.onExit('start')}>
            {t('onboarding.done.start')}
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={() => go('tools')}>
            {t('onboarding.done.installTool')}
          </Button>
        )}
      </>
    )
  }

  const index = stepIndex(step)
  return (
    <div
      className="onb"
      role="region"
      aria-label={t('onboarding.label')}
      onKeyDown={(e) => {
        // Tab wraps inside the page (the same rule as a Modal's trap): focus used to leave for the title bar and the
        // app hidden under this page.
        if (e.key === 'Tab' && !e.defaultPrevented) {
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE))
          const action = modalKeyAction('Tab', e.shiftKey, items.indexOf(document.activeElement as HTMLElement), items.length)
          if (action !== null && action !== 'close') {
            e.preventDefault()
            items[action.focus]?.focus()
          }
          return
        }
        // Esc skips, no confirm. A dialog opened from a step stops its own Esc before it gets here.
        if (e.key !== 'Escape' || e.defaultPrevented) return
        e.preventDefault()
        p.onExit('skip')
      }}
    >
      <div className="onb__page">
        <div className="onb__progress" role="group" aria-label={t('onboarding.stepsLabel')}>
          <ol className="onb__dots" aria-hidden="true">
            {ONBOARDING_STEPS.map((s, i) => (
              <li key={s} className={i === index ? 'is-current' : i < index ? 'is-past' : undefined} />
            ))}
          </ol>
          <span>{t('onboarding.step', { n: index + 1, total: ONBOARDING_STEPS.length })}</span>
        </div>
        <div className="onb__body">{body}</div>
        <div className="onb__foot">
          {index > 0 && step !== 'done' && (
            <Button variant="ghost" onClick={() => go(prevStep(step))}>
              {t('onboarding.back')}
            </Button>
          )}
          {step !== 'done' && (
            <Button variant="ghost" onClick={() => p.onExit('skip')}>
              {t('onboarding.skip')}
            </Button>
          )}
          <span className="onb__spacer" />
          {actions}
        </div>
      </div>
    </div>
  )
}

/** A status line: an icon and a word, never colour alone (DESIGN-W11 §2). */
function Status({ ok, text }: { ok: boolean; text: string }): React.JSX.Element {
  return (
    <p className={ok ? 'onb__status is-ok' : 'onb__status'}>
      <Icon name={ok ? 'check' : 'pending'} />
      <span>{text}</span>
    </p>
  )
}

/** Accounts already added (with sign-in where needed), accounts found on this computer (one click to add), and a
 *  sign-in for a new one per installed CLI. */
function AccountsStep({
  accounts,
  cliInstalled
}: {
  accounts: Account[]
  cliInstalled: { claude: boolean; codex: boolean } | null
}): React.JSX.Element {
  const { t } = useI18n()
  const { loginMap } = useAccountStatus(accounts)
  const [found, setFound] = useState<DetectCandidate[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [signIn, setSignIn] = useState<Account | null>(null)

  useEffect(() => {
    void window.api.accounts.detect().then(setFound).catch(() => setFound([]))
  }, [])
  const known = new Set(accounts.map((a) => a.configDir))
  const candidates = found.filter((c) => !known.has(c.configDir))

  const add = async (c: DetectCandidate): Promise<void> => {
    setBusy(c.configDir)
    try {
      await window.api.accounts.import({ label: c.suggestedLabel, configDir: c.configDir, provider: c.provider })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }
  const signInNew = async (provider: Provider): Promise<void> => {
    setBusy(provider)
    try {
      setSignIn(await window.api.accounts.create({ label: PROVIDER_META[provider].displayName, provider }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }
  const providers = (['claude', 'codex'] as const).filter((pr) => cliInstalled?.[pr])

  return (
    <>
      {accounts.length > 0 && (
        <Card className="onb__card onb__list">
          {accounts.map((a) => (
            <div key={a.id} className="onb__row">
              <ProviderBadge provider={a.provider ?? 'claude'} />
              <span className="onb__row-main">{a.label}</span>
              {loginMap[a.id] === true && (
                <Chip tone="ok" dot>
                  {t('account.status.loggedIn')}
                </Chip>
              )}
              {loginMap[a.id] === false && (
                <Button size="sm" icon={<Icon name="login" size={14} />} onClick={() => setSignIn(a)}>
                  {t('account.signIn.button')}
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
      {candidates.length > 0 && (
        <>
          <div className="onb__label">{t('onboarding.accounts.found')}</div>
          <Card className="onb__card onb__list">
            {candidates.map((c) => (
              <div key={c.configDir} className="onb__row">
                <ProviderBadge provider={c.provider} />
                <span className="onb__row-main">
                  <span>{c.suggestedLabel}</span>
                  <span className="onb__path">{c.configDir}</span>
                </span>
                <Chip tone={c.loggedIn ? 'ok' : 'neutral'} dot>
                  {c.loggedIn ? t('account.status.loggedIn') : t('account.status.notLoggedIn')}
                </Chip>
                <Button size="sm" icon={<Icon name="add" size={14} />} loading={busy === c.configDir} onClick={() => void add(c)}>
                  {t('onboarding.accounts.add')}
                </Button>
              </div>
            ))}
          </Card>
        </>
      )}
      {accounts.length === 0 && candidates.length === 0 && <p className="onb__dim">{t('onboarding.accounts.none')}</p>}
      <div className="onb__inline">
        {providers.map((pr) => (
          <Button key={pr} icon={<Icon name="login" />} loading={busy === pr} onClick={() => void signInNew(pr)}>
            {t('onboarding.accounts.signInWith', { name: PROVIDER_META[pr].displayName })}
          </Button>
        ))}
      </div>
      {signIn && <AccountSignInDialog account={signIn} onClose={() => setSignIn(null)} />}
    </>
  )
}
