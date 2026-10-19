// W6-A intake state and calls, shared by the New plan dialog (NewPlanDialog.tsx) and the Start page (W9-E,
// pages/StartPage.tsx). Moved out of NewPlanDialog unchanged; the two frames only draw it.
import { useEffect, useState } from 'react'
import { DEFAULT_CONCURRENCY, MAX_CONCURRENT_WORKERS, type Job, type Project } from '../../../../core/orchestration/types'
import { jobNameOf } from '../../../../core/orchestration/jobName'
import { useI18n } from '../../i18n/I18nProvider'
import { formFailure, type OrchDoor } from '../../lib/orchDoor'
import { intakeRequest, type IntakeTab } from './intakeRequest'

/** A GitHub issue as `sources-items` answers it. */
export interface IssueRow {
  id: string
  title: string
  selectable?: boolean
  reason?: string
}

export interface IntakeOptions {
  door: OrchDoor
  /** The open project's folder: picked first. */
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
  const [projectId, setProjectId] = useState('')
  const [text, setText] = useState(o.initialText ?? '')
  const [fixlist, setFixlist] = useState(false)
  const [approveAsk, setApproveAsk] = useState(false)
  const [files, setFiles] = useState<string[]>(o.initialFiles ?? [])
  const [scope, setScope] = useState('')
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState(false)
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
      setProjectId((cur) => cur || (list.find((p) => p.path === cwd) ?? list[0])?.id || '')
    })
  }, [door, cwd])
  const project = projects.find((p) => p.id === projectId) ?? null
  // W7-B: the project's own worker count, unless the form this was opened from carried one
  const projectConcurrency = project?.concurrency
  useEffect(() => {
    if (o.concurrency === undefined && projectConcurrency !== undefined) setConcurrency(Math.min(projectConcurrency, MAX_CONCURRENT_WORKERS))
  }, [o.concurrency, projectId, projectConcurrency])
  // W8-C plan after plan: "Start after", among the project's plans that are not archived (`jobs-list` leaves those out)
  const [after, setAfter] = useState('')
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    setAfter('')
    if (!projectId) return
    void door.command('jobs-list', { project: projectId }).then((r) => {
      if (r.status === 200 && Array.isArray(r.body)) setPlans((r.body as Job[]).map((j) => ({ id: j.id, name: jobNameOf(j) })))
    })
  }, [door, projectId])

  // The GitHub search, a moment after the last key: GitHub's search is rate limited.
  const searching = o.searchIssues ?? tab === 'github'
  useEffect(() => {
    if (!searching || project === null) return
    const timer = setTimeout(() => {
      void door
        .command('sources-items', { source: 'github', project: project.id, ...(query.trim() ? { query: query.trim() } : {}), ...(mine ? { assignedToMe: true } : {}) })
        .then((r) => {
          const body = r.body as { items?: IssueRow[]; error?: string } | null
          if (r.status === 200 && Array.isArray(body?.items)) {
            setIssues(body.items)
            setError(null)
          } else setError(typeof body?.error === 'string' ? body.error : t('jobs.new.failed'))
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [searching, project, query, mine, door, t])

  const request = intakeRequest({
    tab,
    text,
    fixlist,
    files,
    scope,
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

  /** `planArgs`: W9-E, extra `jobs-plan` arguments (Start's delivery and approval, when they differ from the project's). */
  const create = async (planArgs?: Record<string, unknown>): Promise<void> => {
    if (request === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const reply = await door.command(request.cmd, request.args)
      if (reply.status >= 400) {
        setError(formFailure(reply, t as never, 'jobs.new.failed').message)
        return
      }
      const id = (reply.body as { id: string }).id
      // Every intake ends with its planner started; a planner that does not start leaves the Job as a draft.
      // W8-C: or queued after another plan (`jobs-set --after`): the Host starts its planner once that one is delivered.
      const planned = await door.command(after ? 'jobs-set' : 'jobs-plan', after ? { id, after } : { id, ...planArgs })
      if (planned.status >= 400) {
        const why = (planned.body as { error?: unknown } | null)?.error
        setError(`${t('jobs.new.plannerFailed')}${typeof why === 'string' ? `: ${why}` : ''}`)
        return
      }
      o.onCreated(id)
    } catch {
      setError(t('jobs.new.failed'))
    } finally {
      setBusy(false)
    }
  }

  return {
    tab, setTab, projects, projectId, setProjectId, project, text, setText, fixlist, setFixlist, approveAsk, setApproveAsk,
    files, setFiles, addFiles, addPaths, scope, setScope, query, setQuery, mine, setMine, issues, picked, setPicked,
    assignMe, setAssignMe, instructions, setInstructions, account, setAccount, concurrency, setConcurrency, after,
    setAfter, plans, busy, error, request, create
  }
}

export type Intake = ReturnType<typeof useIntake>
