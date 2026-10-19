// W9-E Start (DESIGN §2 "Start"): where a plan begins. One composer, two modes, the options the project defaults, and
// the W6-A intake's own state and calls (intake/useIntake.ts), so submitting does what the New plan dialog does.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CircleDot, FileText, ListOrdered, Paperclip, ShieldCheck, Sparkles, SquareTerminal, X } from 'lucide-react'
import type { Account, OrchSnapshot } from '../../../../core/types'
import { MAX_CONCURRENT_WORKERS, PROJECT_DEFAULTS, type DeliveryMode } from '../../../../core/orchestration/types'
import { defaultAccountIdOf } from '../../../../core/accounts/defaultAccount'
import { foldsPathCase } from '../../../../core/files/paths'
import { useI18n } from '../../i18n/I18nProvider'
import { localDoor } from '../../lib/orchDoor'
import { AccountSelect } from '../AccountSelect'
import { openPage } from '../shell/navigation'
import { Button, Card, Chip, Field, Icon } from '../ui'
import { IssuePicker } from '../intake/IssuePicker'
import { useIntake, type IssueRow } from '../intake/useIntake'
import {
  consolesIn, defaultMode, dropOpensStart, filesFromDrop, intakeTab, lookupArgs, primaryLabel, shouldLandOnStart,
  type NameLookup, type StartMode, type StartRequest
} from './startLogic'
import './start.css'

type OpenStart = React.Dispatch<React.SetStateAction<StartRequest | null>>

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function StartPage({
  req,
  cwd,
  accounts,
  onClose,
  onOpenConsole,
  onOtherSources
}: {
  req: StartRequest
  /** The project folder the plan is made in. */
  cwd: string
  accounts: Account[]
  onClose: () => void
  /** "Just open a console": the console form (NewSessionDialog). */
  onOpenConsole: () => void
  /** The plugin sources window (SourceJobModal), for a ticket from a source other than GitHub. */
  onOtherSources: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const door = useMemo(() => localDoor(window.api, cwd), [cwd])
  const [chosen, setChosen] = useState<StartMode | undefined>(req.mode)
  const [audit, setAudit] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [approvalChoice, setApprovalChoice] = useState<'ask' | 'auto'>()
  const [deliveryChoice, setDeliveryChoice] = useState<DeliveryMode>()
  const [handsOffChoice, setHandsOffChoice] = useState<boolean>()

  const intake = useIntake({
    door,
    cwd,
    initialText: req.text,
    initialFiles: req.files,
    tabOf: ({ files, text, picked }) => intakeTab({ mode: defaultMode({ files, text, chosen }), files, audit, issues: picked }),
    searchIssues: issuesOpen,
    onCreated: () => {
      onClose()
      openPage('agents')
    }
  })
  const { project, files, text, picked } = intake
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
    ...(mode === 'plan' && !handsOff && (approval === 'auto') !== projectAuto ? { autoApprove: approval === 'auto' ? 'on' : 'off' } : {}),
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

  const fileInput = useRef<HTMLInputElement>(null)
  const afterName = intake.plans.find((p) => p.id === intake.after)?.name
  const go = primaryLabel({ mode, files, text, after: afterName, named: names && !namesRefused ? names.picked?.length : undefined }, t as never)
  const pick = (id: string, on: boolean): void => intake.setPicked((cur) => (on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id)))
  const name = project?.name ?? baseName(cwd)

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
      <div className="start-inner">
        <header className="start-head">
          <div>
            <h1>{t('start.title', { project: name })}</h1>
            <p>{t(mode === 'plan' ? 'start.next.plan' : 'start.next.prompts')}</p>
          </div>
          <Button variant="ghost" icon={<X size={16} aria-hidden="true" />} aria-label={t('start.close')} onClick={onClose} disabled={intake.busy} />
        </header>

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
          {(files.length > 0 || audit || picked.length > 0) && (
            <div className="start-chips">
              {files.map((f) => (
                <span key={f} className="start-chip" title={f}>
                  <Chip>{baseName(f)}</Chip>
                  <button type="button" aria-label={t('start.remove', { name: baseName(f) })} onClick={() => intake.setFiles((cur) => cur.filter((x) => x !== f))}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              {picked.map((id) => (
                <span key={`#${id}`} className="start-chip">
                  <Chip tone="info">#{id}</Chip>
                  <button type="button" aria-label={t('start.remove', { name: `#${id}` })} onClick={() => pick(id, false)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              {audit && (
                <span className="start-chip">
                  <Chip tone="warn">{t('start.audit')}</Chip>
                  <button type="button" aria-label={t('start.remove', { name: t('start.audit') })} onClick={() => setAudit(false)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              )}
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
            <Button size="sm" variant="ghost" icon={<ShieldCheck size={14} aria-hidden="true" />} aria-pressed={audit} onClick={() => setAudit((v) => !v)}>
              {t('start.audit')}
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
                      <input type="text" value={dirEdit} onChange={(e) => setDirEdit(e.target.value)} aria-label={t('start.names.change')} autoFocus />
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
          {audit && <Field label={t('intake.scope')} hint={t('intake.auditHint')} value={intake.scope} onChange={(e) => intake.setScope(e.target.value)} placeholder="all" />}
          {issuesOpen && (
            <IssuePicker
              intake={intake}
              onAutoPick={() => void intake.create(planArgs, { handsOff: planArgs.handsOff as 'on' | 'off' | undefined })}
            />
          )}
        </Card>

        <div className="start-modes" role="radiogroup">
          {(
            [
              ['plan', Sparkles, 'start.mode.plan', 'start.mode.planHint'],
              ['prompts', FileText, 'start.mode.prompts', 'start.mode.promptsHint']
            ] as const
          ).map(([m, glyph, label, hint]) => (
            <Card key={m} tone={mode === m ? 'focus' : 'plain'} role="radio" aria-checked={mode === m} onClick={() => setChosen(m)}>
              <span className="start-mode-title">
                <Icon icon={glyph} />
                {t(label)}
              </span>
              <span className="start-mode-hint">{t(hint)}</span>
            </Card>
          ))}
        </div>

        <div className="start-options">
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
            label={t('start.opt.start')}
            value={intake.after}
            onChange={(e) => intake.setAfter(e.target.value)}
            options={[{ value: '', label: t('start.opt.now') }, ...intake.plans.map((p) => ({ value: p.id, label: t('start.opt.after', { plan: p.name }) }))]}
          />
          <Field
            kind="select"
            label={t('start.opt.approval')}
            value={approval}
            // as delivery: Plan it for me sets approval as its planner starts, which a queued plan does later
            disabled={handsOff || (mode === 'plan' && intake.after !== '')}
            onChange={(e) => setApprovalChoice(e.target.value as 'ask' | 'auto')}
            options={[
              { value: 'ask', label: t('start.opt.ask') },
              { value: 'auto', label: t('start.opt.auto') }
            ]}
          />
          {/* #117: apart from bypass permissions (an app setting): this one also decides the plan's questions itself */}
          <Field
            kind="toggle"
            label={t('start.opt.handsOff')}
            hint={t('start.opt.handsOffHint')}
            checked={handsOff}
            // a queued plan starts through `jobs-set --after`, which takes no hands-off, as with approval
            disabled={mode === 'plan' && intake.after !== ''}
            onChange={setHandsOffChoice}
          />
          <div className="ui-field">
            <label className="ui-field__label">{t('jobs.new.coordinator')}</label>
            <AccountSelect accounts={accounts} value={intake.account} onChange={intake.setAccount} allLabel={t('jobs.new.coordinatorPick')} />
          </div>
        </div>

        {intake.error && <p className="warn">{intake.error}</p>}
        <div className="start-go">
          <Button variant="primary" loading={intake.busy} disabled={intake.busy || intake.request === null || namesRefused} onClick={() => void intake.create(planArgs)}>
            {go.label}
          </Button>
          {go.note && <span className="start-go-note">{go.note}</span>}
        </div>

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
          <Button icon={<SquareTerminal size={16} aria-hidden="true" />} onClick={onOpenConsole}>
            {t('start.pickup.console')}
          </Button>
        </section>
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
