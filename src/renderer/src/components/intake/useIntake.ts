// W6-A intake state and calls behind the Start page (W9-E, pages/StartPage.tsx), the one place a plan is made (T2);
// the page only draws it.
import { useEffect, useState } from 'react'
import { DEFAULT_CONCURRENCY, MAX_CONCURRENT_WORKERS, type Project } from '../../../../core/orchestration/types'
import { livePlans, type PlanRow } from '../pages/startLogic'
import { useI18n } from '../../i18n/I18nProvider'
import { formFailure, type OrchDoor } from '../../lib/orchDoor'
import { intakeRequest, type IntakeTab, type PlanningMode } from './intakeRequest'

export interface IntakeOptions {
  door: OrchDoor
  /** The chosen project's folder; '' while none is chosen (no fallback to another project). */
  cwd: string
  /** `sessionId`: the planner's terminal, when the planner started now (not when the plan queued after another). */
  onCreated: (jobId: string, sessionId?: string) => void
  /** W7-D (#67): the worker count typed in the form this was opened from, kept across the switch. */
  concurrency?: number
  /** W7-B: the description it opens with (the first plan of a new project). */
  initialText?: string
  /** W9-E: files it opens with (a drop on the window). */
  initialFiles?: string[]
  /** W9-E: the tab the frame decides from what is filled in (Start: from its mode and files); the hook's own otherwise. */
  tabOf?: (s: { files: string[]; text: string }) => IntakeTab
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
  const [priority, setPriority] = useState(0)
  // T4: who plans, the person with the planner (chat) or the planner alone (auto)
  const [planning, setPlanning] = useState<PlanningMode>('chat')
  const [instructions, setInstructions] = useState('')
  const [account, setAccount] = useState('')
  const [concurrency, setConcurrency] = useState(Math.min(o.concurrency ?? DEFAULT_CONCURRENCY, MAX_CONCURRENT_WORKERS))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tab = o.tabOf ? o.tabOf({ files, text }) : ownTab

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

  const request = intakeRequest({
    tab,
    text,
    fixlist,
    files,
    priority,
    planning,
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

  /** Plans a made Job: its planner starts, or it queues after another plan (`jobs set --after`: the Host starts its
   *  planner once that one is delivered). #116: the queued plan keeps Start's approval and delivery too. Returns the
   *  planner's session (none when queued), or null after it set the error. */
  const planJob = async (id: string, planArgs?: Record<string, unknown>): Promise<{ sessionId?: string } | null> => {
    // Every intake ends with its planner started; a planner that does not start leaves the Job as a draft.
    const planned = await door.command(after ? 'jobs-set' : 'jobs-plan', after ? { id, after, ...planArgs } : { id, ...planArgs })
    if (planned.status < 400) {
      const sessionId = (planned.body as { sessionId?: unknown } | null)?.sessionId
      return typeof sessionId === 'string' ? { sessionId } : {}
    }
    const why = (planned.body as { error?: unknown } | null)?.error
    setError(`${t('jobs.new.plannerFailed')}${typeof why === 'string' ? `: ${why}` : ''}`)
    return null
  }

  /** `planArgs`: W9-E, extra `jobs-plan` arguments (Start's delivery and approval, when they differ from the project's).
   *  T4: jobs-create → jobs-plan; `onCreated` gets the planner's session so Start can open its terminal. */
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
      const id = (reply.body as { id?: string }).id
      if (id === undefined) {
        setError(t('jobs.new.failed'))
        return
      }
      const planned = await planJob(id, planArgs)
      if (planned) o.onCreated(id, planned.sessionId)
    } catch {
      setError(t('jobs.new.failed'))
    } finally {
      setBusy(false)
    }
  }

  return {
    tab, setTab, projects, setProjects, projectId, project, text, setText, fixlist, setFixlist, approveAsk, setApproveAsk,
    files, setFiles, addFiles, addPaths, priority, setPriority, planning, setPlanning,
    instructions, setInstructions, account, setAccount, concurrency, setConcurrency, after,
    setAfter, plans, busy, error, request, create
  }
}

export type Intake = ReturnType<typeof useIntake>
