// W6-A intake state and calls behind the Start page (W9-E, pages/StartPage.tsx), the one place a plan is made (T2);
// the page only draws it.
import { useEffect, useState } from 'react'
import { DEFAULT_CONCURRENCY, MAX_CONCURRENT_WORKERS, type Project } from '../../../../core/orchestration/types'
import { livePlans, type PlanRow } from '../pages/startLogic'
import { useI18n } from '../../i18n/I18nProvider'
import { formFailure, type OrchDoor } from '../../lib/orchDoor'
import { AUDIT_FOCUS_DEFAULT, autoPickRequest, intakeRequest, issueSearchArgs, type AssigneeFilter, type IntakeFocus, type IntakeTab } from './intakeRequest'

/** A GitHub issue as `sources-items` answers it. */
export interface IssueRow {
  id: string
  title: string
  selectable?: boolean
  reason?: string
}

export interface IntakeOptions {
  door: OrchDoor
  /** The chosen project's folder; '' while none is chosen (no fallback to another project). */
  cwd: string
  onCreated: (jobId: string) => void
  /** W7-D (#67): the worker count typed in the form this was opened from, kept across the switch. */
  concurrency?: number
  /** W7-B: the description it opens with (the first plan of a new project). */
  initialText?: string
  /** W9-E: files it opens with (a drop on the window). */
  initialFiles?: string[]
  /** W9-E: the tab the frame decides from what is filled in (Start: from its mode and sources); the hook's own otherwise. */
  tabOf?: (s: { files: string[]; text: string; picked: string[] }) => IntakeTab
  /** W9-E: search GitHub while the frame shows its issue picker; otherwise while the tab is 'github'. */
  searchIssues?: boolean
}

export function useIntake(o: IntakeOptions) {
  const { door, cwd } = o
  const { t } = useI18n()
  const [ownTab, setTab] = useState<IntakeTab>('describe')
  const [projects, setProjects] = useState<Project[]>([])
  const [text, setText] = useState(o.initialText ?? '')
  const [fixlist, setFixlist] = useState(false)
  const [approveAsk, setApproveAsk] = useState(false)
  const [files, setFiles] = useState<string[]>(o.initialFiles ?? [])
  const [scope, setScope] = useState<string[]>([])
  const [focus, setFocus] = useState<IntakeFocus[]>([...AUDIT_FOCUS_DEFAULT])
  const [priority, setPriority] = useState(0)
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState<AssigneeFilter>('all')
  // #119 Let Astera pick: the optional label and cap, and the issues it left out
  const [autoLabel, setAutoLabel] = useState('')
  const [autoMax, setAutoMax] = useState('')
  const [skipped, setSkipped] = useState<{ number: number; why: string }[]>([])
  const [issues, setIssues] = useState<IssueRow[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [assignMe, setAssignMe] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [account, setAccount] = useState('')
  const [concurrency, setConcurrency] = useState(Math.min(o.concurrency ?? DEFAULT_CONCURRENCY, MAX_CONCURRENT_WORKERS))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tab = o.tabOf ? o.tabOf({ files, text, picked }) : ownTab

  useEffect(() => {
    void door.command('projects-list', {}).then((r) => {
      if (r.status !== 200 || !Array.isArray(r.body)) return
      const list = r.body as Project[]
      setProjects(list)
    })
  }, [door, cwd])
  // The project is the one whose folder `cwd` names; none while nothing is chosen
  const project = projects.find((p) => p.path === cwd) ?? null
  const projectId = project?.id ?? ''
  // W7-B: the project's own worker count, unless the form this was opened from carried one
  const projectConcurrency = project?.concurrency
  useEffect(() => {
    if (o.concurrency === undefined && projectConcurrency !== undefined) setConcurrency(Math.min(projectConcurrency, MAX_CONCURRENT_WORKERS))
  }, [o.concurrency, projectId, projectConcurrency])
  // W8-C plan after plan: "Start after", among the project's plans that have not finished
  const [after, setAfter] = useState('')
  const [plans, setPlans] = useState<ReturnType<typeof livePlans>>([])
  useEffect(() => {
    setAfter('')
    setPlans([])
    if (!projectId) return
    void door.command('jobs-list', { project: projectId }).then((r) => {
      if (r.status === 200 && Array.isArray(r.body)) setPlans(livePlans(r.body as PlanRow[]))
    })
  }, [door, projectId])

  // The GitHub search, a moment after the last key: GitHub's search is rate limited.
  const searching = o.searchIssues ?? tab === 'github'
  useEffect(() => {
    if (!searching || project === null) return
    const timer = setTimeout(() => {
      void door
        .command('sources-items', issueSearchArgs({ projectId: project.id, query, assignee }))
        .then((r) => {
          const body = r.body as { items?: IssueRow[]; error?: string } | null
          if (r.status === 200 && Array.isArray(body?.items)) {
            setIssues(body.items)
            setError(null)
          } else setError(typeof body?.error === 'string' ? body.error : t('jobs.new.failed'))
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [searching, project, query, assignee, door, t])

  // #119: why Let Astera pick cannot start, shown beside its button (null: it can)
  const autoPickWhy = project === null ? t('start.issues.autoNoProject') : account === '' ? t('start.issues.autoNoCoordinator') : null

  const request = intakeRequest({
    tab,
    text,
    fixlist,
    files,
    scope,
    focus,
    priority,
    issues: picked,
    assignMe,
    instructions,
    project: project && { id: project.id, path: project.path },
    coordinatorAccount: account,
    concurrency,
    approveAsk
  })

  const addPaths = (paths: string[]): void => setFiles((cur) => [...cur, ...paths.filter((p) => p !== '' && !cur.includes(p))])
  const addFiles = (list: FileList | null): void => {
    if (list) addPaths(Array.from(list, (f) => window.api.files.pathForFile(f)))
  }

  /** Plans a made Job: its planner starts, or it queues after another plan (`jobs-set --after`: the Host starts its
   *  planner once that one is delivered). #116: the queued plan keeps Start's approval and delivery too. False after
   *  it set the error. */
  const planJob = async (id: string, planArgs?: Record<string, unknown>): Promise<boolean> => {
    // Every intake ends with its planner started; a planner that does not start leaves the Job as a draft.
    const planned = await door.command(after ? 'jobs-set' : 'jobs-plan', after ? { id, after, ...planArgs } : { id, ...planArgs })
    if (planned.status < 400) return true
    const why = (planned.body as { error?: unknown } | null)?.error
    setError(`${t('jobs.new.plannerFailed')}${typeof why === 'string' ? `: ${why}` : ''}`)
    return false
  }

  /** `planArgs`: W9-E, extra `jobs-plan` arguments (Start's delivery and approval, when they differ from the project's).
   *  #119: `auto` makes the plans from Astera's own pick of the open issues; the first one is planned here. */
  const create = async (planArgs?: Record<string, unknown>, auto?: { handsOff?: 'on' | 'off' }): Promise<void> => {
    const req = auto ? autoPickRequest({ project: project && { id: project.id, path: project.path }, coordinatorAccount: account, concurrency, instructions, assignMe, label: autoLabel, max: autoMax, handsOff: auto.handsOff }) : request
    if (req === null || busy) return
    setBusy(true)
    setError(null)
    setSkipped([])
    try {
      const reply = await door.command(req.cmd, req.args)
      if (reply.status >= 400) {
        setError(formFailure(reply, t as never, 'jobs.new.failed').message)
        return
      }
      const body = reply.body as { id?: string; jobs?: { id: string }[]; skipped?: { number: number; why: string }[] }
      setSkipped(body.skipped ?? [])
      const id = auto ? body.jobs?.[0]?.id : body.id
      if (id === undefined) {
        setError(t('jobs.new.failed'))
        return
      }
      if (await planJob(id, planArgs)) o.onCreated(id)
    } catch {
      setError(t('jobs.new.failed'))
    } finally {
      setBusy(false)
    }
  }

  return {
    tab, setTab, projects, setProjects, projectId, project, text, setText, fixlist, setFixlist, approveAsk, setApproveAsk,
    files, setFiles, addFiles, addPaths, scope, setScope, focus, setFocus, priority, setPriority, query, setQuery, assignee, setAssignee, autoLabel, setAutoLabel, autoMax, setAutoMax, skipped, issues, picked, setPicked,
    assignMe, setAssignMe, instructions, setInstructions, account, setAccount, concurrency, setConcurrency, after,
    setAfter, plans, busy, error, request, create, autoPickWhy
  }
}

export type Intake = ReturnType<typeof useIntake>
