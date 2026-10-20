// W9-E Start (DESIGN-W11 §9 "Start"): where a plan begins, the one place one is made (T2). One create-job flow:
// Project (required) → what to build → mode → Options (folded) → one Create in a sticky footer. The W6-A intake keeps
// its own state and calls (intake/useIntake.ts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, CircleDot, FileText, ListOrdered, Paperclip, Plus, ShieldCheck, Sparkles, SquareTerminal, X } from 'lucide-react'
import type { Account, OrchSnapshot, ScheduleRule } from '../../../../core/types'
import { MAX_CONCURRENT_WORKERS, PROJECT_DEFAULTS, type DeliveryMode } from '../../../../core/orchestration/types'
import { defaultAccountIdOf } from '../../../../core/accounts/defaultAccount'
import { foldsPathCase } from '../../../../core/files/paths'
import { useI18n } from '../../i18n/I18nProvider'
import { formFailure, localDoor } from '../../lib/orchDoor'
import { pollFileIndex } from '../../lib/fileIndexPoll'
import { AccountSelect } from '../AccountSelect'
import { ScheduleRuleFields } from '../ScheduleRuleFields'
import { openPage } from '../shell/navigation'
import { Button, Card, Chip, Field, Icon, IconButton, Input, Tabs } from '../ui'
import { IssuePicker } from '../intake/IssuePicker'
import { AUDIT_FOCUSES } from '../intake/intakeRequest'
import { useIntake, type IssueRow } from '../intake/useIntake'
import {
  addScopePath, blockedReason, consolesIn, defaultMode, dropOpensStart, filesFromDrop, handsOffSaveArgs, intakeTab, lookupArgs, optionsSummary, primaryLabel,
  scheduledArgs, shouldLandOnStart, type NameLookup, type StartMode, type StartRequest
} from './startLogic'
import './start.css'

type OpenStart = React.Dispatch<React.SetStateAction<StartRequest | null>>

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function StartPage({
  req,
  cwd: baseCwd,
  defaultProject,
  accounts,
  onClose,
  onOpenConsole,
  onOtherSources
}: {
  req: StartRequest
  /** A folder the Host can be asked through while no project is chosen. */
  cwd: string
  /** The project folder preselected in the picker (the window's current project); none: the picker starts empty. */
  defaultProject?: string
  accounts: Account[]
  onClose: () => void
  /** "Just open a console": the console form (NewSessionDialog). */
  onOpenConsole: () => void
  /** The plugin sources window (SourceJobModal), for a ticket from a source other than GitHub. */
  onOtherSources: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  // The Project picker: the plan is made in the chosen project's folder, '' until one is chosen
  const [cwd, setCwd] = useState(defaultProject ?? '')
  const door = useMemo(() => localDoor(window.api, cwd || baseCwd), [cwd, baseCwd])
  const [chosen, setChosen] = useState<StartMode | undefined>(req.mode)
  const [optsOpen, setOptsOpen] = useState(false)
  const [handsOffError, setHandsOffError] = useState<string | null>(null)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [approvalChoice, setApprovalChoice] = useState<'ask' | 'auto'>()
  const [deliveryChoice, setDeliveryChoice] = useState<DeliveryMode>()
  const [handsOffChoice, setHandsOffChoice] = useState<boolean>()

  const intake = useIntake({
    door,
    cwd,
    initialText: req.text,
    initialFiles: req.files,
    tabOf: ({ files, text, picked }) => intakeTab({ mode: defaultMode({ files, text, chosen }), files, issues: picked }),
    searchIssues: issuesOpen,
    onCreated: () => {
      onClose()
      openPage('agents')
    }
  })
  const { project, files, text, picked } = intake
  // T14: a Job that runs on a schedule is made by jobs-create alone, with its rule; no planner opens for it
  const [scheduled, setScheduled] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleRule | null>(null)
  const [schedBusy, setSchedBusy] = useState(false)
  const [schedError, setSchedError] = useState<string | null>(null)
  const schedArgs = scheduled ? scheduledArgs(intake.request, schedule) : null
  const createScheduled = async (): Promise<void> => {
    if (!schedArgs || schedBusy) return
    setSchedBusy(true)
    setSchedError(null)
    try {
      const r = await door.command('jobs-create', schedArgs)
      if (r.status >= 400) setSchedError(formFailure(r, t as never, 'jobs.new.failed').message)
      else {
        onClose()
        openPage('agents')
      }
    } catch {
      setSchedError(t('jobs.new.failed'))
    } finally {
      setSchedBusy(false)
    }
  }
  const mode = defaultMode({ files, text, chosen })
  const projectAuto = project?.autoApprove ?? PROJECT_DEFAULTS.autoApprove
  const projectHandsOff = project?.handsOff ?? PROJECT_DEFAULTS.handsOff
  const projectDelivery: DeliveryMode = project?.delivery ?? PROJECT_DEFAULTS.delivery
  // Run as written defaults to auto: the owner wrote it (DESIGN §2)
  // #117: hands-off decides for the owner, so it approves itself
  const handsOff = handsOffChoice ?? projectHandsOff
  const approval = handsOff ? 'auto' : (approvalChoice ?? (mode === 'prompts' || projectAuto ? 'auto' : 'ask'))
  const delivery = deliveryChoice ?? projectDelivery
  const planArgs = {
    ...(handsOff !== projectHandsOff ? { handsOff: handsOff ? 'on' : 'off' } : {}),
    ...(mode !== 'prompts' && !handsOff && (approval === 'auto') !== projectAuto ? { autoApprove: approval === 'auto' ? 'on' : 'off' } : {}),
    ...(delivery !== projectDelivery ? { delivery } : {})
  }
  // Run as written asks for approval only when the owner says so (`--approve ask`)
  const { setApproveAsk } = intake
  useEffect(() => setApproveAsk(approval === 'ask'), [approval, setApproveAsk])

  // The coordinator: the signed-in Claude account the command bar would pick
  const { setAccount } = intake
  useEffect(() => {
    void door.signedInIds(accounts).then((ids) => setAccount((cur) => cur || defaultAccountIdOf('claude', accounts, ids) || ''))
  }, [door, accounts, setAccount])

  // "Or pick up": the GitHub issues assigned to the owner
  const [assigned, setAssigned] = useState<IssueRow[] | null>(null)
  const projectId = project?.id
  useEffect(() => {
    if (!projectId) return
    void door.command('sources-items', { source: 'github', project: projectId, assignee: 'me' }).then((r) => {
      const body = r.body as { items?: IssueRow[] } | null
      setAssigned(r.status === 200 && Array.isArray(body?.items) ? body.items.slice(0, 5) : null)
    })
  }, [door, projectId])

  // Full width below the title bar (W9-B owns its height)
  const [top, setTop] = useState(0)
  useLayoutEffect(() => {
    const measure = (): void => setTop(document.querySelector('.titlebar')?.getBoundingClientRect().bottom ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // W10-A Run as written by name: the typed prompt names, looked up on the Host a moment after the last key
  const [lookup, setLookup] = useState<NameLookup | null>(null)
  const [dirEdit, setDirEdit] = useState<string | null>(null)
  const [dirError, setDirError] = useState<string | null>(null)
  const [lookupTick, setLookupTick] = useState(0)
  const projectPath = project?.path
  useEffect(() => {
    const args = projectPath ? lookupArgs({ mode, files, text, cwd: projectPath }) : null
    if (args === null) {
      setLookup(null)
      return
    }
    const timer = setTimeout(() => {
      void door.command('jobs-create', args).then((r) => setLookup(r.status === 200 && (r.body as NameLookup | null)?.names ? (r.body as NameLookup) : null))
    }, 300)
    return () => clearTimeout(timer)
  }, [door, mode, files, text, projectPath, lookupTick])
  const names = lookup !== null && files.length === 0 ? lookup : null
  const namesRefused = (names?.problems?.length ?? 0) > 0
  const saveDir = async (): Promise<void> => {
    if (!project || dirEdit === null) return
    const r = await door.command('projects-set', { id: project.id, promptsDir: dirEdit.trim() || 'none' })
    if (r.status !== 200) return setDirError((r.body as { error?: string } | null)?.error ?? t('jobs.new.failed'))
    setDirError(null)
    setDirEdit(null)
    setLookupTick((n) => n + 1)
  }

  // T2: Hands-off sticks: switching it saves the project's default, so the next plan opens the same way
  const saveHandsOff = async (on: boolean): Promise<void> => {
    setHandsOffChoice(on)
    if (!project) return
    const r = await door.command('projects-set', handsOffSaveArgs(project.id, on))
    if (r.status !== 200) return setHandsOffError((r.body as { error?: string } | null)?.error ?? t('jobs.new.failed'))
    setHandsOffError(null)
    // off clears it back to the default (projects-set)
    intake.setProjects((cur) => cur.map((p) => (p.id === project.id ? { ...p, handsOff: on ? true : undefined } : p)))
    setHandsOffChoice(undefined)
  }

  // T2 Audit: the scope picker's suggestions, from the same file index as the composer's `@` menu
  const [scopeQuery, setScopeQuery] = useState('')
  const [scopeHints, setScopeHints] = useState<string[]>([])
  useEffect(() => {
    if (mode !== 'audit' || !projectPath || scopeQuery.trim() === '') return setScopeHints([])
    return pollFileIndex(
      () => window.api.files.index(projectPath, scopeQuery.trim()),
      ({ paths }) => setScopeHints(paths),
      () => setScopeHints([]),
      { pollMs: 500 }
    )
  }, [mode, projectPath, scopeQuery])
  const addScope = (typed: string): void => {
    intake.setScope((cur) => addScopePath(cur, typed))
    setScopeQuery('')
  }

  const fileInput = useRef<HTMLInputElement>(null)
  const afterName = intake.plans.find((p) => p.id === intake.after)?.name
  const go = primaryLabel({ mode, files, text, after: afterName, named: names && !namesRefused ? names.picked?.length : undefined, scope: intake.scope }, t as never)
  const summary = optionsSummary(
    {
      concurrency: intake.concurrency,
      delivery,
      approval,
      account: accounts.find((a) => a.id === intake.account)?.label,
      priority: intake.priority,
      handsOff,
      after: afterName
    },
    t as never
  )
  const pick = (id: string, on: boolean): void => intake.setPicked((cur) => (on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id)))
  const name = project?.name ?? ''

  const blocked = blockedReason({ project: project !== null, request: intake.request !== null }, t as never)
  const removeChip = (name: string, onRemove: () => void): React.JSX.Element => (
    <IconButton size="sm" icon={<X size={14} />} label={t('start.remove', { name })} onClick={onRemove} />
  )
  const MODES = [
    ['plan', Sparkles, 'start.mode.plan', 'start.mode.planHint'],
    ['audit', ShieldCheck, 'start.mode.audit', 'start.mode.auditHint'],
    ['prompts', FileText, 'start.mode.prompts', 'start.mode.promptsHint']
  ] as const

  return (
    <div
      className="start-page"
      style={{ top }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        intake.addPaths(filesFromDrop(e.dataTransfer.files, window.api.files.pathForFile))
      }}
    >
      <div className="start-scroll">
        <div className="start-inner">
          {/* 1. Project, top-left and required */}
          <header className="start-head">
            <Button variant="ghost" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={onClose} disabled={intake.busy}>
              {t('start.back')}
            </Button>
            <Field
              kind="select"
              className="start-project"
              label={t('start.project')}
              value={project?.path ?? ''}
              onChange={(e) => setCwd(e.target.value)}
              disabled={intake.busy}
              required
              error={project === null && text.trim() !== '' ? t('start.project.required') : undefined}
              options={[{ value: '', label: t('start.project.choose') }, ...intake.projects.map((p) => ({ value: p.path, label: p.name }))]}
            />
          </header>

          {/* 2. What to build */}
          <h1 className="start-title">{project ? t('start.title', { project: name }) : t('start.titleNoProject')}</h1>
          <Card className="start-composer">
            <textarea
              className="start-text"
              rows={8}
              value={text}
              onChange={(e) => intake.setText(e.target.value)}
              placeholder={t('start.placeholder')}
              aria-label={t('start.placeholder')}
              autoFocus
            />
            {(files.length > 0 || picked.length > 0) && (
              <div className="start-chips">
                {files.map((f) => (
                  <Chip key={f} className="start-chip">
                    <span title={f}>{baseName(f)}</span>
                    {removeChip(baseName(f), () => intake.setFiles((cur) => cur.filter((x) => x !== f)))}
                  </Chip>
                ))}
                {picked.map((id) => (
                  <Chip key={`#${id}`} tone="info" className="start-chip">
                    #{id}
                    {removeChip(`#${id}`, () => pick(id, false))}
                  </Chip>
                ))}
              </div>
            )}
            <div className="start-attach">
              <Button size="sm" variant="ghost" icon={<Paperclip size={14} aria-hidden="true" />} onClick={() => fileInput.current?.click()}>
                {t('start.attach')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  intake.addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <Button size="sm" variant="ghost" icon={<CircleDot size={14} aria-hidden="true" />} aria-expanded={issuesOpen} onClick={() => setIssuesOpen((v) => !v)}>
                {t('start.issues')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onOtherSources}>
                {t('start.otherSources')}
              </Button>
              {project?.promptsDir !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ListOrdered size={14} aria-hidden="true" />}
                  onClick={() => {
                    intake.setText('next waves')
                    setChosen('prompts')
                  }}
                >
                  {t('start.names.next')}
                </Button>
              )}
            </div>
            {mode === 'prompts' && lookup !== null && files.length > 0 && (
              <p className="start-names-note">{t('start.names.ignored', { n: files.filter((f) => /\.md$/i.test(f)).length })}</p>
            )}
            {names && (
              <div className="start-names" aria-live="polite">
                {names.dir != null && (
                  <div className="start-names-dir">
                    {dirEdit === null ? (
                      <>
                        <span>{t('start.names.from', { dir: names.dir })}</span>
                        <Button size="sm" variant="ghost" onClick={() => setDirEdit(names.dir ?? '')}>
                          {t('start.names.change')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Input value={dirEdit} onChange={(e) => setDirEdit(e.target.value)} aria-label={t('start.names.change')} autoFocus />
                        <Button size="sm" onClick={() => void saveDir()}>
                          {t('start.names.save')}
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {dirError && <p className="warn">{dirError}</p>}
                {names.why?.map((w) => <p key={w} className="start-names-why">{w}</p>)}
                {(names.picked?.length ?? 0) > 0 && (
                  <ul className="start-names-list">
                    {names.picked!.map((p) => (
                      <li key={p.id}>
                        <code>{p.id}</code> → <code>{p.path}</code>
                      </li>
                    ))}
                  </ul>
                )}
                {names.skipped?.map((x) => <p key={x.id} className="start-names-why">{t('start.names.skipped', { id: x.id, why: x.why })}</p>)}
                {names.problems?.map((p) => <p key={p} className="warn">{p}</p>)}
              </div>
            )}
            {issuesOpen && (
              <IssuePicker
                intake={intake}
                onAutoPick={() => void intake.create(planArgs, { handsOff: planArgs.handsOff as 'on' | 'off' | undefined })}
              />
            )}
          </Card>

          {/* 3. Mode: one segmented choice and one line on what it does */}
          <section className="start-mode">
            <Tabs
              variant="segmented"
              label={t('start.mode.label')}
              value={mode}
              onChange={(m) => setChosen(m)}
              items={MODES.map(([m, glyph, label]) => ({
                id: m,
                label: (
                  <span className="start-mode-tab">
                    <Icon icon={glyph} size={14} />
                    {t(label)}
                  </span>
                )
              }))}
            />
            <p className="start-mode-hint">{t(MODES.find(([m]) => m === mode)![3])}</p>
          </section>

          {mode === 'audit' && (
            <Card className="start-audit">
              <div className="start-audit-scope">
                <span className="ui-field__label" id="start-scope-label">{t('start.audit.scope')}</span>
                <div className="start-chips" aria-labelledby="start-scope-label">
                  {intake.scope.length === 0 && <Chip>{t('start.audit.all')}</Chip>}
                  {intake.scope.map((p) => (
                    <Chip key={p} tone="info" className="start-chip">
                      {p}
                      {removeChip(p, () => intake.setScope((cur) => cur.filter((x) => x !== p)))}
                    </Chip>
                  ))}
                </div>
                <div className="start-audit-add">
                  <Field
                    label={t('start.audit.add')}
                    hint={t('start.audit.scopeHint')}
                    value={scopeQuery}
                    list="start-scope-hints"
                    placeholder="src/core"
                    onChange={(e) => setScopeQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      addScope(scopeQuery)
                    }}
                  />
                  <Button icon={<Plus size={16} aria-hidden="true" />} disabled={scopeQuery.trim() === ''} onClick={() => addScope(scopeQuery)}>
                    {t('start.audit.addButton')}
                  </Button>
                  <datalist id="start-scope-hints">
                    {scopeHints.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                </div>
              </div>
              <fieldset className="start-audit-focus">
                <legend className="ui-field__label">{t('start.audit.focus')}</legend>
                {AUDIT_FOCUSES.map((f) => (
                  <label key={f}>
                    <input
                      type="checkbox"
                      checked={intake.focus.includes(f)}
                      onChange={(e) => intake.setFocus((cur) => AUDIT_FOCUSES.filter((x) => (x === f ? e.target.checked : cur.includes(x))))}
                    />
                    {t(`start.audit.focus.${f}` as const)}
                  </label>
                ))}
              </fieldset>
            </Card>
          )}

          {/* 4. Options, folded: one line says what they are set to */}
          <section className="start-opts">
            <div className="start-more">
              <Button
                variant="ghost"
                size="sm"
                icon={optsOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                aria-expanded={optsOpen}
                aria-controls="start-options"
                onClick={() => setOptsOpen((v) => !v)}
              >
                {t('start.options')}
              </Button>
              {!optsOpen && <span className="start-more-summary">{summary}</span>}
            </div>
            {optsOpen && (
              <div className="start-options" id="start-options">
                {/* #117: apart from bypass permissions (an app setting): this one also decides the plan's questions itself.
                    T2: first, and it sticks as the project's default */}
                <Field
                  kind="toggle"
                  className="start-handsoff"
                  label={t('start.opt.handsOff')}
                  hint={t('start.opt.handsOffHint')}
                  error={handsOffError}
                  checked={handsOff}
                  // a queued plan's hands-off goes through `jobs-set --after`, with its approval and delivery
                  onChange={(on) => void saveHandsOff(on)}
                />
                <Field
                  kind="select"
                  label={t('start.opt.start')}
                  value={intake.after}
                  onChange={(e) => intake.setAfter(e.target.value)}
                  options={[
                    { value: '', label: t('start.opt.now') },
                    ...intake.plans.map((p) => ({ value: p.id, label: `${t('start.opt.after', { plan: p.name })} · ${t(`start.opt.state.${p.state}` as const)}` }))
                  ]}
                />
                {/* W1-B Job.priority: 0 is the default and is not sent */}
                <Field
                  kind="number"
                  label={t('start.opt.priority')}
                  step={1}
                  value={intake.priority}
                  onChange={(e) => {
                    const n = e.target.valueAsNumber
                    intake.setPriority(Number.isFinite(n) ? Math.trunc(n) : 0)
                  }}
                />
                <div className="ui-field">
                  <label className="ui-field__label">{t('jobs.new.coordinator')}</label>
                  <AccountSelect accounts={accounts} value={intake.account} onChange={intake.setAccount} allLabel={t('jobs.new.coordinatorPick')} />
                </div>
                <Field
                  kind="number"
                  label={t('start.opt.consoles')}
                  min={1}
                  max={MAX_CONCURRENT_WORKERS}
                  value={intake.concurrency}
                  onChange={(e) => {
                    const n = e.target.valueAsNumber
                    intake.setConcurrency(Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), MAX_CONCURRENT_WORKERS) : 1)
                  }}
                />
                <Field
                  kind="select"
                  label={t('start.opt.delivery')}
                  value={delivery}
                  // a queued plan starts through `jobs-set --after`, which takes no delivery: it keeps the project's
                  disabled={intake.after !== ''}
                  onChange={(e) => setDeliveryChoice(e.target.value as DeliveryMode)}
                  options={[
                    { value: 'pr', label: t('delivery.pr') },
                    { value: 'push', label: t('delivery.push', { branch: project?.deliveryBranch ?? t('delivery.defaultBranch') }) }
                  ]}
                />
                <Field
                  kind="select"
                  label={t('start.opt.approval')}
                  value={approval}
                  // as delivery: a planned mode sets approval as its planner starts, which a queued plan does later
                  disabled={handsOff || (mode !== 'prompts' && intake.after !== '')}
                  onChange={(e) => setApprovalChoice(e.target.value as 'ask' | 'auto')}
                  options={[
                    { value: 'ask', label: t('start.opt.ask') },
                    { value: 'auto', label: t('start.opt.auto') }
                  ]}
                />
                <Field kind="toggle" label={t('start.more.schedule')} hint={t('jobs.new.scheduleHint')} checked={scheduled} onChange={setScheduled} />
                {scheduled && (
                  <div className="jobs-sched">
                    <ScheduleRuleFields onChange={setSchedule} />
                    <p className="warn-text">{t('jobs.new.scheduleOverlapHint')}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="start-pickup">
            <h2>{t('start.pickup')}</h2>
            {assigned !== null && (
              <div className="start-pickup-group">
                <span className="start-pickup-label">{t('start.pickup.issues')}</span>
                {assigned.length === 0 && <span className="start-pickup-none">{t('start.pickup.none')}</span>}
                {assigned.map((i) => (
                  <Card key={i.id} onClick={() => pick(i.id, true)} disabled={i.selectable === false} title={i.reason}>
                    #{i.id} {i.title}
                  </Card>
                ))}
              </div>
            )}
            <Button variant="ghost" icon={<SquareTerminal size={16} aria-hidden="true" />} onClick={onOpenConsole}>
              {t('start.pickup.console')}
            </Button>
          </section>
        </div>
      </div>

      {/* 5. One Create, always in view */}
      <footer className="start-foot">
        <div className="start-foot-inner">
          <div className="start-foot-notes" aria-live="polite">
            {intake.error || schedError ? <p className="warn">{intake.error ?? schedError}</p> : blocked ? <span>{blocked}</span> : go.note && <span>{go.note}</span>}
          </div>
          <Button
            variant="primary"
            size="lg"
            loading={intake.busy || schedBusy}
            disabled={intake.busy || schedBusy || blocked !== null || namesRefused || (scheduled && schedArgs === null)}
            onClick={() => void (scheduled ? createScheduled() : intake.create(planArgs))}
          >
            {go.label}
          </Button>
        </div>
      </footer>
    </div>
  )
}

/** Each project lands on Start at most once per app run. */
const landed = new Set<string>()

/** W9-E: a project with no plans and no consoles opens on Start (DESIGN §0), once per project per app run. */
export function useStartLanding(project: string | null, sessions: { cwd: string }[], openStart: OpenStart): void {
  const live = useRef({ project, sessions })
  live.current = { project, sessions }
  useEffect(() => {
    if (!project || landed.has(project)) return
    landed.add(project)
    void (window.api.orch.peek(project) as Promise<OrchSnapshot | null>).then((snap) => {
      // read when the answer comes: the consoles taken back from the Host may have arrived meanwhile
      const now = live.current
      if (!snap || now.project !== project) return
      if (shouldLandOnStart({ plans: snap.runs.length, consoles: consolesIn(now.sessions, project, foldsPathCase()) }))
        openStart((cur) => cur ?? {})
    })
  }, [project, openStart])
}

/** W9-E: files dropped anywhere on the window open Start with them attached, unless something else took the drop.
 *  useWorkbench's capture-phase guard calls preventDefault on every drop (so Chromium never navigates to the file), so
 *  `defaultPrevented` alone says nothing. A document capture listener, which always runs after that window one, marks
 *  the event and sees any later preventDefault (React's handlers, CodeMirror, the dialogs' drop zones). */
export function useDropToStart(openStart: OpenStart): void {
  useEffect(() => {
    const taken = new WeakMap<Event, () => boolean>()
    const mark = (e: DragEvent): void => {
      let prevented = false
      const own = e.preventDefault.bind(e)
      e.preventDefault = () => {
        prevented = true
        own()
      }
      taken.set(e, () => prevented)
    }
    const drop = (e: DragEvent): void => {
      const files = filesFromDrop(e.dataTransfer?.files, window.api.files.pathForFile)
      if (dropOpensStart({ defaultPrevented: taken.get(e)?.() ?? e.defaultPrevented, files })) openStart((cur) => cur ?? { files })
    }
    document.addEventListener('drop', mark, true)
    window.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('drop', mark, true)
      window.removeEventListener('drop', drop)
    }
  }, [openStart])
}
