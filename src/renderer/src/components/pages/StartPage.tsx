// T17 New plan (DESIGN-W11 §9 "Start", DESIGN-W13 look): one composer. The box holds its attachments as chips; its
// footer the mode (segmented), the primary button and a menu of other ways in. The plan is for the title bar's project
// (a sub-project picker only for a workspace that has some, a project picker only on All projects). Below it, "Start
// from…" starters, then one settings row that opens the settings grouped as Who / When / How. The settings start from
// the project's defaults and the last choice made here for it. The W6-A intake keeps its own state and calls
// (intake/useIntake.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, OrchSnapshot, ScheduleRule } from '../../../../core/types'
import { MAX_CONCURRENT_WORKERS, type DeliveryMode, type Project } from '../../../../core/orchestration/types'
import { EFFORTS, type Effort } from '../../../../core/orchestration/roleModels'
import { foldsPathCase } from '../../../../core/files/paths'
import { useI18n } from '../../i18n/I18nProvider'
import { localDoor } from '../../lib/orchDoor'
import { invalidate, readCached, useCachedRead } from '../../lib/readCache'
import { useProjectScope } from '../../state/useProjectScope'
import { openActivity, openConsole } from '../shell/navigation'
import { Button, Card, Chip, Field, Icon, IconButton, Input, Menu, PageHeader, Select, Tabs, Textarea, Tooltip } from '../ui'
import { useIntake } from '../intake/useIntake'
import { BranchPicker } from '../delivery/BranchPicker'
import { useDeliveryChoices } from '../delivery/useDeliveryChoices'
import { ScheduleRuleFields } from '../ScheduleRuleFields'
import { useAccountUsage } from '../../hooks/useAccountUsage'
import {
  AUTO_ACCOUNT, STARTERS, attachableOf, STARTER_MODE, accountPickOptions, afterCreate, askOptions, blockedReason, consolesIn, dropOpensStart, filesFromDrop, intakeTab, isSubmitKey, lastMode,
  lookupArgs, planningOf, primaryLabel, projectChoice, projectDefaults, rememberSetting, saveMode, settingsSummary, shouldLandOnStart, startSettings, withStarter, type NameLookup, type StarterId,
  type StartMode, type StartSettings, type StartWhen, type StartRequest
} from './startLogic'
import './start.css'

type OpenStart = React.Dispatch<React.SetStateAction<StartRequest | null>>

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i

export function StartPage({
  req,
  cwd: baseCwd,
  accounts,
  onClose,
  onOpenConsole,
  onOtherSources
}: {
  req: StartRequest
  /** A folder the Host can be asked through while no project is chosen. */
  cwd: string
  accounts: Account[]
  onClose: () => void
  /** "Open a console": the console form (NewSessionDialog). */
  onOpenConsole: () => void
  /** The issue picker (SourceJobModal), behind the "From GitHub issues" starter. */
  onOtherSources: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const scope = useProjectScope()
  const door = useMemo(() => localDoor(window.api, scope.path || baseCwd), [scope.path, baseCwd])
  // the title bar's project until the list is read, so the first frame already says who the plan is for
  const projectsKey = `start:projects:${door.projectKey}`
  const projectsRead = useCachedRead(projectsKey, async () => {
    const r = await door.command('projects-list', {})
    if (r.status !== 200 || !Array.isArray(r.body)) throw new Error('projects-list')
    return r.body as Project[]
  })
  const fallbackProjects = useMemo(() => (scope.project ? [scope.project] : []), [scope.project])
  const projects = projectsRead.data ?? fallbackProjects
  // No push says the project list changed: a form opened with a list in the cache asks again once (a first read is
  // already under way and needs no second one).
  const hadProjects = useRef(projectsRead.data !== undefined)
  useEffect(() => {
    if (hadProjects.current) invalidate(projectsKey)
  }, [projectsKey])
  // The sub-project picked here, by id; the title bar's selection otherwise. A new title-bar pick drops it.
  const [picked, setPicked] = useState<string>()
  useEffect(() => setPicked(undefined), [scope.projectId])
  const choice = projectChoice(projects, scope.projectId, picked)
  const project = choice.project ?? null
  const projectId = project?.id

  // The settings: the project's defaults, then the last choice made here for it (per project, this computer)
  const defaults = projectDefaults(project ?? undefined, choice.root)
  const [settings, setSettings] = useState<StartSettings>(defaults)
  const defaultsKey = JSON.stringify(defaults)
  useEffect(() => {
    if (projectId) setSettings(startSettings(projectId, JSON.parse(defaultsKey) as StartSettings))
  }, [projectId, defaultsKey])
  const change = (c: Partial<StartSettings>): void => {
    setSettings((cur) => ({ ...cur, ...c }))
    if (projectId) rememberSetting(projectId, c)
  }
  // An account no longer listed reads as Auto
  const account = accounts.some((a) => a.id === settings.account) ? settings.account : ''
  // The plan's own target branch, ahead of its project's; a new project pick starts from the project's again
  const [targetBranch, setTargetBranch] = useState('')
  useEffect(() => setTargetBranch(''), [projectId])
  const projectBranch = project?.deliveryBranch ?? choice.root?.deliveryBranch
  const delivery = useDeliveryChoices(project?.path, settings.delivery, targetBranch || projectBranch)

  const [chosen, setChosen] = useState<StartMode | undefined>(req.mode)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mode, setModeState] = useState<StartMode>(req.mode ?? 'chat')
  const intake = useIntake({
    door,
    project,
    // the delivery shown is the one sent, so a saved one this folder cannot do is never used
    settings: { ...settings, account, delivery: delivery.mode },
    deliveryBranch: targetBranch,
    initialText: req.text,
    initialFiles: req.files,
    tabOf: ({ files }) => intakeTab({ mode, files }),
    // T4: straight into the planner's terminal; a plan queued after another, or on a schedule, has none yet
    onCreated: (_jobId, sessionId) => {
      onClose()
      const next = afterCreate(sessionId)
      if ('openConsole' in next) openConsole(next.openConsole)
      else openActivity(next.openActivity)
    }
  })
  const { files, text, setPlanning } = intake
  // The project's last mode, until the person picks one here (or New already did)
  useEffect(() => {
    if (chosen === undefined && projectId) setModeState(lastMode(projectId) ?? 'chat')
  }, [chosen, projectId])
  useEffect(() => setPlanning(planningOf(mode)), [mode, setPlanning])
  const pickMode = (m: StartMode): void => {
    setChosen(m)
    setModeState(m)
    if (projectId) saveMode(projectId, m)
  }

  // When: right away, after another plan (jobs-set --after), or on a schedule (T14: jobs-create with its rule, no
  // planner). A chat Job has no objective to repeat, so it cannot be scheduled.
  const [scheduled, setScheduled] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleRule | null>(null)
  const scheduling = scheduled && mode !== 'chat'
  const when: StartWhen = scheduling ? 'schedule' : intake.after ? 'after' : 'now'
  const pickWhen = (w: StartWhen): void => {
    setScheduled(w === 'schedule')
    intake.setAfter(w === 'after' ? (intake.plans[0]?.id ?? '') : '')
  }

  // T5b: the planner's account. Auto sends none, so the Host picks the one with most room by usage; a picked account
  // is only a preference
  const signedInKey = `start:signedIn:${door.projectKey}:${accounts.map((a) => a.id).join(',')}`
  const signedInRead = useCachedRead(signedInKey, async () => [...(await door.signedInIds(accounts))], { invalidateOn: ['accounts:changed'] })
  // Login status changes without the id list changing: a form opened with an answer in the cache asks again once.
  const hadSignedIn = useRef(signedInRead.data !== undefined)
  useEffect(() => {
    if (hadSignedIn.current) invalidate(signedInKey)
  }, [signedInKey])
  const signedIn = useMemo<ReadonlySet<string>>(() => new Set(signedInRead.data), [signedInRead.data])
  const usage = useAccountUsage()

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

  const fileInput = useRef<HTMLInputElement>(null)
  // T4: an image attached here (pasted or chosen) shows its own picture on the chip; object URLs, freed when it goes
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const thumbsRef = useRef(thumbs)
  thumbsRef.current = thumbs
  useEffect(() => () => Object.values(thumbsRef.current).forEach((u) => URL.revokeObjectURL(u)), [])
  const [attachError, setAttachError] = useState<string | null>(null)
  const attach = async (list: File[]): Promise<void> => {
    const { attached, failed } = await attachableOf(list, window.api.files.pathForFile, window.api.files.savePasted)
    const fresh = attached.filter((a) => a.file.type.startsWith('image/') && !thumbsRef.current[a.path])
    if (fresh.length > 0) setThumbs((cur) => ({ ...cur, ...Object.fromEntries(fresh.map((a) => [a.path, URL.createObjectURL(a.file)])) }))
    intake.addPaths(attached.map((a) => a.path))
    setAttachError(failed.length > 0 ? t('start.paste.failed', { name: failed.join(', ') }) : null)
  }
  const removeFile = (f: string): void => {
    intake.setFiles((cur) => cur.filter((x) => x !== f))
    const url = thumbs[f]
    if (url === undefined) return
    URL.revokeObjectURL(url)
    setThumbs((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => k !== f)))
  }
  const afterName = intake.plans.find((p) => p.id === intake.after)?.name
  const go = primaryLabel({ mode, files, text, after: afterName, named: names && !namesRefused ? names.picked?.length : undefined }, t as never)
  const blocked = blockedReason({ project: project !== null, text: text.trim() !== '' || files.length > 0, request: intake.request !== null }, t as never)
  const canSubmit = !intake.busy && blocked === null && !namesRefused && !(scheduling && schedule === null)
  const submit = (): void => {
    if (canSubmit) void intake.create(scheduling ? schedule : undefined)
  }
  const reason = blocked ?? (scheduling && schedule === null ? t('start.needSchedule') : null)

  // T14 starters: a template in the box and the mode; "From GitHub issues" opens the picker, "From a file" the chooser
  const templates = STARTERS.flatMap((s) => (s.text ? [t(s.text as never)] : []))
  const startWith = (id: StarterId): void => {
    if (id === 'issues') return onOtherSources()
    const starter = STARTERS.find((s) => s.id === id)
    if (starter?.text) intake.setText((cur) => withStarter(cur, t(starter.text as never), templates))
    pickMode(STARTER_MODE)
    if (id === 'file') fileInput.current?.click()
  }
  const hasPromptsDir = project?.promptsDir !== undefined

  const accountOptions = accountPickOptions(accounts, signedIn, usage, t as never)
  const accountName = account === '' ? undefined : accounts.find((a) => a.id === account)?.label
  const deliveryLabel = delivery.options.find((o) => o.value === delivery.mode)?.label ?? delivery.mode
  const summary = settingsSummary(
    {
      account: accountName,
      when,
      after: afterName,
      concurrency: settings.concurrency,
      delivery: deliveryLabel,
      replan: mode === 'prompts' ? undefined : settings.replan,
      handsOff: settings.handsOff,
      effort: settings.effort
    },
    t as never
  )
  // The one-line hint of the setting under the pointer or the focus, in one line under the settings
  const [hint, setHint] = useState<string | null>(null)
  const hintOf = (e: React.SyntheticEvent): void => setHint((e.target as HTMLElement).closest<HTMLElement>('[data-hint]')?.dataset.hint ?? null)
  const error = intake.error ?? attachError

  return (
    <div
      className="start-page"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        intake.addPaths(filesFromDrop(e.dataTransfer.files, window.api.files.pathForFile))
      }}
      // T4: Ctrl+V of an image or copied files attaches them, anywhere on the page; a text paste has no files and goes through
      onPaste={(e) => {
        if (intake.busy || e.clipboardData.files.length === 0) return
        e.preventDefault()
        void attach(Array.from(e.clipboardData.files))
      }}
    >
      <div className="start-scroll">
        <div className="start-inner">
          <PageHeader
            className="start-head"
            title={t('start.q.title')}
            leading={
              <Button variant="ghost" size="sm" icon={<Icon name="back" size={14} />} onClick={onClose} disabled={intake.busy}>
                {t('start.back')}
              </Button>
            }
            actions={
              // Who the plan is for: the title bar's project, read-only; asked for only on All projects
              <div className="start-for">
                {choice.ask ? (
                  <Select
                    className="start-for-pick"
                    ariaLabel={t('start.project')}
                    placeholder={t('start.project.choose')}
                    value=""
                    onChange={(id) => scope.select(id)}
                    disabled={intake.busy}
                    items={askOptions(projects)}
                  />
                ) : choice.root ? (
                  <>
                    <span className="start-for-label">
                      <Icon name="folder" size={14} />
                      <span className="start-for-name" title={choice.root.path}>
                        {t('start.for', { project: choice.root.name })}
                      </span>
                    </span>
                    {choice.members.length > 0 && (
                      <Select
                        className="start-for-pick"
                        ariaLabel={t('start.subproject')}
                        value={project?.id ?? ''}
                        onChange={setPicked}
                        disabled={intake.busy}
                        items={choice.members.map((p) => ({ value: p.id, label: p.id === choice.root?.id ? t('start.subproject.whole') : p.name }))}
                      />
                    )}
                  </>
                ) : null}
              </div>
            }
          />

          {/* One composer: the box, its attachments, the mode and the primary button */}
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
              <ul className="start-files" aria-label={t('start.attach')}>
                {files.map((f) => (
                  <li key={f}>
                    <Chip className="start-file">
                      {thumbs[f] ? <img className="start-thumb" src={thumbs[f]} alt="" /> : <Icon name={IMAGE.test(f) ? 'image' : 'file'} size={14} />}
                      <span className="start-file-name" title={f}>
                        {baseName(f)}
                      </span>
                      <IconButton size="sm" icon={<Icon name="close" size={14} />} label={t('start.remove', { name: baseName(f) })} onClick={() => removeFile(f)} />
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
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
                {dirError && <p className="start-warn">{dirError}</p>}
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
                {names.problems?.map((p) => <p key={p} className="start-warn">{p}</p>)}
              </div>
            )}
            <div className="start-composer-bar">
              <div className="start-bar-tools">
                <IconButton icon={<Icon name="fileAdd" size={16} />} label={`${t('start.attach')} · ${t('start.attach.hint')}`} onClick={() => fileInput.current?.click()} disabled={intake.busy} />
                {mode === 'prompts' && hasPromptsDir && (
                  <Button size="sm" variant="ghost" icon={<Icon name="tasks" size={14} />} onClick={() => intake.setText('next waves')}>
                    {t('start.names.next')}
                  </Button>
                )}
                {go.note && <span className="start-bar-note">{go.note}</span>}
              </div>
              <div className="start-bar-go">
                <Tooltip content={t(`start.how.${mode}Hint` as never)} side="top" className="start-mode">
                  <Tabs
                    variant="segmented"
                    label={t('start.how.label')}
                    value={mode}
                    onChange={(m: StartMode) => pickMode(m)}
                    items={[
                      { id: 'chat', label: t('start.mode.chat') },
                      { id: 'auto', label: t('start.mode.auto') },
                      { id: 'prompts', label: t('start.mode.prompts') }
                    ]}
                  />
                </Tooltip>
                {/* The reason it is off is its tooltip, not a line far away */}
                <Tooltip content={reason ?? t('start.hint.submit')} side="top" className="start-go">
                  <Button variant="primary" loading={intake.busy} disabled={!canSubmit} onClick={submit}>
                    {go.label}
                  </Button>
                </Tooltip>
                <Menu
                  label={t('start.moreWays')}
                  align="end"
                  trigger={{ icon: <Icon name="chevronDown" size={14} />, variant: 'secondary', disabled: intake.busy }}
                  items={[{ id: 'console', label: t('new.consoleLink'), icon: <Icon name="terminal" size={14} />, onSelect: onOpenConsole }]}
                />
              </div>
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void attach(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </Card>
          {error && (
            <p className="start-warn" role="alert">
              {error}
            </p>
          )}

          <div className="start-starters" role="group" aria-label={t('start.starters.label')}>
            <span className="start-starters-label">{t('start.starters.label')}</span>
            {STARTERS.map((s) => (
              <Button key={s.id} size="sm" variant="ghost" disabled={intake.busy} onClick={() => startWith(s.id)}>
                {t(`start.starter.${s.id}` as never)}
              </Button>
            ))}
          </div>

          {/* The settings: one summary row; nothing behind it is needed to start */}
          <section className="start-settings">
            <Button
              variant="ghost"
              className="start-summary"
              icon={<Icon name="settings" size={14} />}
              aria-expanded={settingsOpen}
              aria-controls="start-options"
              aria-label={`${t('start.settings')}: ${summary.join(' · ')}`}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              {summary.map((part, i) => (
                <span key={i} className="start-summary-part">
                  {part}
                </span>
              ))}
              <Icon name={settingsOpen ? 'chevronUp' : 'chevronDown'} size={14} className="start-summary-chevron" />
            </Button>
            {settingsOpen && (
              <div className="start-options" id="start-options" onMouseOver={hintOf} onFocus={hintOf} onMouseLeave={() => setHint(null)}>
                <fieldset className="start-group">
                  <legend>{t('start.group.who')}</legend>
                  <div data-hint={t('start.adv.accountHint')}>
                    <Field
                      kind="select"
                      label={t('accounts.pick')}
                      value={account || AUTO_ACCOUNT}
                      onChange={(e) => change({ account: e.target.value === AUTO_ACCOUNT ? '' : e.target.value })}
                      options={accountOptions}
                    />
                  </div>
                  <div data-hint={t('start.adv.effortHint')}>
                    <Field
                      kind="select"
                      label={t('start.effort')}
                      value={settings.effort || 'auto'}
                      onChange={(e) => change({ effort: e.target.value === 'auto' ? '' : (e.target.value as Effort) })}
                      options={[{ value: 'auto', label: t('start.effort.auto') }, ...EFFORTS.map((e) => ({ value: e, label: e }))]}
                    />
                  </div>
                </fieldset>
                <fieldset className="start-group">
                  <legend>{t('start.group.when')}</legend>
                  <div data-hint={t('start.adv.whenHint')}>
                    <Tabs
                      variant="segmented"
                      label={t('start.group.when')}
                      value={when}
                      onChange={(w: StartWhen) => pickWhen(w)}
                      items={[
                        { id: 'now', label: t('start.opt.now') },
                        { id: 'after', label: t('start.when.after'), disabled: intake.plans.length === 0 },
                        { id: 'schedule', label: t('start.when.schedule'), disabled: mode === 'chat' }
                      ]}
                    />
                  </div>
                  {when === 'after' && (
                    <div data-hint={t('start.adv.afterHint')}>
                      <Field
                        kind="select"
                        label={t('start.opt.start')}
                        value={intake.after}
                        onChange={(e) => intake.setAfter(e.target.value)}
                        options={intake.plans.map((p) => ({ value: p.id, label: `${t('start.opt.after', { plan: p.name })} · ${t(`start.opt.state.${p.state}` as const)}` }))}
                      />
                    </div>
                  )}
                  {when === 'schedule' && (
                    <div className="start-sched">
                      <ScheduleRuleFields initial={schedule} onChange={setSchedule} />
                      <p className="start-warn-text">{t('jobs.new.scheduleOverlapHint')}</p>
                    </div>
                  )}
                </fieldset>
                <fieldset className="start-group">
                  <legend>{t('start.group.how')}</legend>
                  <div data-hint={t('start.adv.workersHint')}>
                    <Field
                      kind="number"
                      label={t('start.opt.consoles')}
                      min={1}
                      max={MAX_CONCURRENT_WORKERS}
                      value={settings.concurrency}
                      onChange={(e) => {
                        const n = e.target.valueAsNumber
                        change({ concurrency: Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), MAX_CONCURRENT_WORKERS) : 1 })
                      }}
                    />
                  </div>
                  <div data-hint={delivery.reason ?? t('start.adv.deliveryHint')}>
                    <Field
                      kind="select"
                      label={t('start.opt.delivery')}
                      value={delivery.mode}
                      onChange={(e) => change({ delivery: e.target.value as DeliveryMode })}
                      options={delivery.options}
                    />
                  </div>
                  {project && (
                    <div className="ui-field" data-hint={t('delivery.targetHint')}>
                      <span className="ui-field__label">{t('delivery.target')}</span>
                      <BranchPicker repoPath={project.path} value={targetBranch} onChange={setTargetBranch} command={door.command} defaultBranch={projectBranch} />
                    </div>
                  )}
                  {mode !== 'prompts' && (
                    <div data-hint={t('start.adv.replanHint')}>
                      <Field
                        kind="select"
                        label={t('start.adv.replan')}
                        value={settings.replan}
                        onChange={(e) => change({ replan: e.target.value as 'waves' | 'off' })}
                        options={[
                          { value: 'waves', label: t('start.adv.replan.waves') },
                          { value: 'off', label: t('start.adv.replan.off') }
                        ]}
                      />
                    </div>
                  )}
                  {/* #117: apart from bypass permissions (an app setting): this one also decides the plan's questions itself */}
                  <div data-hint={t('start.opt.handsOffHint')}>
                    <Field kind="toggle" className="start-toggle" label={t('start.opt.handsOff')} checked={settings.handsOff} onChange={(on) => change({ handsOff: on })} />
                  </div>
                </fieldset>
                <p className="start-hint" aria-live="polite">
                  {hint ?? delivery.reason ?? ''}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
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
    void readCached(`start:peek:${project}`, () => window.api.orch.peek(project) as Promise<OrchSnapshot | null>).then((snap) => {
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
