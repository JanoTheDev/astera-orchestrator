// T14 Start (DESIGN-W11 §9 "Start"): where a plan begins, one clear page. Project first (required), one box with starter
// chips, three plain ways to plan, the rest folded under "More options", one sticky primary button. The W6-A intake keeps
// its own state and calls (intake/useIntake.ts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Account, OrchSnapshot, ScheduleRule } from '../../../../core/types'
import { MAX_CONCURRENT_WORKERS, PROJECT_DEFAULTS, type DeliveryMode } from '../../../../core/orchestration/types'
import { foldsPathCase } from '../../../../core/files/paths'
import { useI18n } from '../../i18n/I18nProvider'
import { formFailure, localDoor } from '../../lib/orchDoor'
import { useAdvancedMode } from '../../state/useAdvancedMode'
import { openActivity, openConsole } from '../shell/navigation'
import { Button, Card, Chip, Field, Icon, IconButton, Input, PageHeader, Tabs, Textarea } from '../ui'
import { useIntake } from '../intake/useIntake'
import { ScheduleRuleFields } from '../ScheduleRuleFields'
import { useAccountUsage } from '../../hooks/useAccountUsage'
import {
  AUTO_ACCOUNT, STARTERS, STARTER_MODE, accountPickOptions, afterCreate, blockedReason, consolesIn, dropOpensStart, filesFromDrop, handsOffSaveArgs, intakeTab, isSubmitKey, lastMode, lookupArgs,
  planningOf, primaryLabel, projectOptions, saveMode, scheduledArgs, shouldLandOnStart, withStarter, type NameLookup, type StarterId, type StartMode, type StartRequest
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
  /** "Open a console": the console form (NewSessionDialog). */
  onOpenConsole: () => void
  /** The issue picker (SourceJobModal), behind the "From GitHub issues" chip. */
  onOtherSources: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  // The Project picker: the plan is made in the chosen project's folder, '' until one is chosen
  const [cwd, setCwd] = useState(defaultProject ?? '')
  const door = useMemo(() => localDoor(window.api, cwd || baseCwd), [cwd, baseCwd])
  const [chosen, setChosen] = useState<StartMode | undefined>(req.mode)
  // Advanced mode opens "More options" by default (T14); otherwise it stays folded until asked
  const [advanced] = useAdvancedMode()
  const [optsOpen, setOptsOpen] = useState(advanced)
  const [handsOffError, setHandsOffError] = useState<string | null>(null)
  const [deliveryChoice, setDeliveryChoice] = useState<DeliveryMode>()
  const [handsOffChoice, setHandsOffChoice] = useState<boolean>()
  const [replanChoice, setReplanChoice] = useState<'waves' | 'off'>()

  const [mode, setModeState] = useState<StartMode>(req.mode ?? 'chat')
  const intake = useIntake({
    door,
    cwd,
    initialText: req.text,
    initialFiles: req.files,
    tabOf: ({ files }) => intakeTab({ mode, files }),
    // T4: straight into the planner's terminal; a plan queued after another has none yet
    onCreated: (_jobId, sessionId) => {
      onClose()
      const next = afterCreate(sessionId)
      if ('openConsole' in next) openConsole(next.openConsole)
      else openActivity(next.openActivity)
    }
  })
  const { project, files, text, setPlanning } = intake
  // The project's last choice, until the person picks one here (or New already did)
  const projectId = project?.id
  useEffect(() => {
    if (chosen === undefined && projectId) setModeState(lastMode(projectId) ?? 'chat')
  }, [chosen, projectId])
  useEffect(() => setPlanning(planningOf(mode)), [mode, setPlanning])
  const pickMode = (m: StartMode): void => {
    setChosen(m)
    setModeState(m)
    if (projectId) saveMode(projectId, m)
  }

  // T14: a Job that runs on a schedule is made by jobs-create alone, with its rule; no planner opens for it
  const [scheduled, setScheduled] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleRule | null>(null)
  const [schedBusy, setSchedBusy] = useState(false)
  const [schedError, setSchedError] = useState<string | null>(null)
  // A chat Job has no objective to repeat: the toggle is off in that mode
  const scheduling = scheduled && mode !== 'chat'
  const schedArgs = scheduling ? scheduledArgs(intake.request, schedule) : null
  const createScheduled = async (): Promise<void> => {
    if (!schedArgs || schedBusy) return
    setSchedBusy(true)
    setSchedError(null)
    try {
      const r = await door.command('jobs-create', schedArgs)
      if (r.status >= 400) setSchedError(formFailure(r, t as never, 'jobs.new.failed').message)
      else {
        onClose()
        openActivity('agents')
      }
    } catch {
      setSchedError(t('jobs.new.failed'))
    } finally {
      setSchedBusy(false)
    }
  }
  const projectAuto = project?.autoApprove ?? PROJECT_DEFAULTS.autoApprove
  const projectHandsOff = project?.handsOff ?? PROJECT_DEFAULTS.handsOff
  const projectDelivery: DeliveryMode = project?.delivery ?? PROJECT_DEFAULTS.delivery
  const projectReplan = project?.replan ?? PROJECT_DEFAULTS.replan
  // #117: hands-off decides for the owner, so it approves itself. Plan on its own and Run prompts approve by themselves
  // (the owner wrote it or chose it); Plan with me follows the project
  const handsOff = handsOffChoice ?? projectHandsOff
  const approval = handsOff || mode !== 'chat' || projectAuto ? 'auto' : 'ask'
  const delivery = deliveryChoice ?? projectDelivery
  const replan = replanChoice ?? projectReplan
  const planArgs = {
    ...(handsOff !== projectHandsOff ? { handsOff: handsOff ? 'on' : 'off' } : {}),
    ...(mode !== 'prompts' && !handsOff && (approval === 'auto') !== projectAuto ? { autoApprove: approval === 'auto' ? 'on' : 'off' } : {}),
    ...(delivery !== projectDelivery ? { delivery } : {}),
    ...(mode !== 'prompts' && replan !== projectReplan ? { replan } : {})
  }
  // Run prompts asks for approval only when the owner says so (`--approve ask`): never from Start
  const { setApproveAsk } = intake
  useEffect(() => setApproveAsk(approval === 'ask'), [approval, setApproveAsk])

  // T5b: the planner's account. Auto (intake.account '') sends none, so the Host picks the one with most room by usage;
  // a picked account is only a preference
  const [signedIn, setSignedIn] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    void door.signedInIds(accounts).then(setSignedIn)
  }, [door, accounts])
  const usage = useAccountUsage()

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

  const fileInput = useRef<HTMLInputElement>(null)
  const afterName = intake.plans.find((p) => p.id === intake.after)?.name
  const go = primaryLabel({ mode, files, text, after: afterName, named: names && !namesRefused ? names.picked?.length : undefined }, t as never)
  const blocked = blockedReason({ project: project !== null, text: text.trim() !== '' || files.length > 0, request: intake.request !== null }, t as never)
  const canSubmit = !intake.busy && !schedBusy && blocked === null && !namesRefused && !(scheduling && schedArgs === null)
  const submit = (): void => {
    if (canSubmit) void (scheduling ? createScheduled() : intake.create(planArgs))
  }
  const removeChip = (name: string, onRemove: () => void): React.JSX.Element => (
    <IconButton size="sm" icon={<Icon name="close" size={14} />} label={t('start.remove', { name })} onClick={onRemove} />
  )

  // T14 starter chips: a template in the box and the mode; "From GitHub issues" opens the picker, "From a file" the chooser
  const templates = STARTERS.flatMap((s) => (s.text ? [t(s.text as never)] : []))
  const startWith = (id: StarterId): void => {
    if (id === 'issues') return onOtherSources()
    const starter = STARTERS.find((s) => s.id === id)
    if (starter?.text) intake.setText((cur) => withStarter(cur, t(starter.text as never), templates))
    pickMode(STARTER_MODE)
    if (id === 'file') fileInput.current?.click()
  }
  const hasPromptsDir = project?.promptsDir !== undefined

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
          <PageHeader
            className="start-head"
            title={t('start.q.title')}
            leading={
              <Button variant="ghost" icon={<Icon name="back" />} onClick={onClose} disabled={intake.busy}>
                {t('start.back')}
              </Button>
            }
          />

          {/* 1. Project: first, required, never "All projects" */}
          <Field
            kind="select"
            className="start-project"
            label={t('start.project')}
            value={project?.path ?? ''}
            onChange={(e) => setCwd(e.target.value)}
            disabled={intake.busy}
            required
            error={project === null && text.trim() !== '' ? t('start.project.required') : undefined}
            options={projectOptions(intake.projects, project?.path ?? '', t('start.project.choose'))}
          />

          {/* 2. One box, then the starter chips */}
          <Card className="start-composer">
            <Textarea
              className="start-text"
              rows={5}
              value={text}
              onChange={(e) => intake.setText(e.target.value)}
              // Enter is a newline; Ctrl+Enter starts
              onKeyDown={(e) => {
                if (!isSubmitKey(e)) return
                e.preventDefault()
                submit()
              }}
              placeholder={t('start.q.placeholder')}
              aria-label={t('start.q.label')}
              autoFocus
            />
            {files.length > 0 && (
              <div className="start-chips">
                {files.map((f) => (
                  <Chip key={f} className="start-chip">
                    <span title={f}>{baseName(f)}</span>
                    {removeChip(baseName(f), () => intake.setFiles((cur) => cur.filter((x) => x !== f)))}
                  </Chip>
                ))}
              </div>
            )}
            {mode === 'prompts' && (
              <div className="start-attach">
                <Button size="sm" variant="ghost" icon={<Icon name="file" size={14} />} onClick={() => fileInput.current?.click()}>
                  {t('start.attach')}
                </Button>
                {hasPromptsDir && (
                  <Button size="sm" variant="ghost" icon={<Icon name="tasks" size={14} />} onClick={() => intake.setText('next waves')}>
                    {t('start.names.next')}
                  </Button>
                )}
              </div>
            )}
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
          </Card>
          <div className="start-starters" role="group" aria-label={t('start.starters.label')}>
            {STARTERS.map((s) => (
              <Button key={s.id} size="sm" variant="secondary" disabled={intake.busy} onClick={() => startWith(s.id)}>
                {t(`start.starter.${s.id}` as never)}
              </Button>
            ))}
          </div>

          {/* 3. How to plan: three plain choices, one line each */}
          <section className="start-mode">
            <Tabs
              variant="segmented"
              label={t('start.how.label')}
              value={mode}
              onChange={(m: StartMode) => pickMode(m)}
              items={[
                { id: 'chat', label: t('start.how.chat') },
                { id: 'auto', label: t('start.how.auto') },
                { id: 'prompts', label: t('start.how.prompts') }
              ]}
            />
            <p className="start-mode-hint">{t(`start.how.${mode}Hint` as never)}</p>
          </section>

          {/* 4. Advanced: folded; nothing in it is needed to start */}
          <section className="start-opts">
            <div className="start-more">
              <Button
                variant="ghost"
                size="sm"
                icon={<Icon name={optsOpen ? 'chevronDown' : 'chevronRight'} size={14} />}
                aria-expanded={optsOpen}
                aria-controls="start-options"
                onClick={() => setOptsOpen((v) => !v)}
              >
                {t('start.more')}
              </Button>
            </div>
            {optsOpen && (
              <div className="start-options" id="start-options">
                <Field
                  kind="select"
                  label={t('accounts.pick')}
                  hint={t('start.adv.accountHint')}
                  value={intake.account || AUTO_ACCOUNT}
                  onChange={(e) => intake.setAccount(e.target.value === AUTO_ACCOUNT ? '' : e.target.value)}
                  options={accountPickOptions(accounts, signedIn, usage, t as never)}
                />
                <Field
                  kind="select"
                  label={t('start.opt.start')}
                  hint={t('start.adv.afterHint')}
                  value={intake.after}
                  onChange={(e) => intake.setAfter(e.target.value)}
                  options={[
                    { value: '', label: t('start.opt.now') },
                    ...intake.plans.map((p) => ({ value: p.id, label: `${t('start.opt.after', { plan: p.name })} · ${t(`start.opt.state.${p.state}` as const)}` }))
                  ]}
                />
                <Field
                  kind="number"
                  label={t('start.opt.consoles')}
                  hint={t('start.adv.workersHint')}
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
                  hint={t('start.adv.deliveryHint')}
                  value={delivery}
                  // a queued plan starts through `jobs-set --after`, which takes no delivery: it keeps the project's
                  disabled={intake.after !== ''}
                  onChange={(e) => setDeliveryChoice(e.target.value as DeliveryMode)}
                  options={[
                    { value: 'pr', label: t('delivery.pr') },
                    { value: 'push', label: t('delivery.push', { branch: project?.deliveryBranch ?? t('delivery.defaultBranch') }) },
                    { value: 'manual', label: t('delivery.manual') }
                  ]}
                />
                {mode !== 'prompts' && (
                  <Field
                    kind="select"
                    label={t('start.adv.replan')}
                    hint={t('start.adv.replanHint')}
                    value={replan}
                    disabled={intake.after !== ''}
                    onChange={(e) => setReplanChoice(e.target.value as 'waves' | 'off')}
                    options={[
                      { value: 'waves', label: t('start.adv.replan.waves') },
                      { value: 'off', label: t('start.adv.replan.off') }
                    ]}
                  />
                )}
                {/* #117: apart from bypass permissions (an app setting): this one also decides the plan's questions itself.
                    T2: it sticks as the project's default */}
                <Field
                  kind="toggle"
                  className="start-handsoff"
                  label={t('start.opt.handsOff')}
                  hint={t('start.opt.handsOffHint')}
                  error={handsOffError}
                  checked={handsOff}
                  onChange={(on) => void saveHandsOff(on)}
                />
                <Field kind="toggle" label={t('start.more.schedule')} hint={t('jobs.new.scheduleHint')} checked={scheduling} disabled={mode === 'chat'} onChange={setScheduled} />
                {scheduling && (
                  <div className="jobs-sched">
                    <ScheduleRuleFields onChange={setSchedule} />
                    <p className="warn-text">{t('jobs.new.scheduleOverlapHint')}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          <Button className="start-console" variant="ghost" icon={<Icon name="terminal" />} onClick={onOpenConsole}>
            {t('new.consoleLink')}
          </Button>
        </div>
      </div>

      {/* 5. One primary button, always in view, with the reason when it is off */}
      <footer className="start-foot">
        <div className="start-foot-inner">
          <div className="start-foot-notes" aria-live="polite">
            {intake.error || schedError ? <p className="warn">{intake.error ?? schedError}</p> : blocked ? <span>{blocked}</span> : <span>{go.note ?? t('start.hint.submit')}</span>}
          </div>
          <Button variant="primary" size="lg" loading={intake.busy || schedBusy} disabled={!canSubmit} onClick={submit}>
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
