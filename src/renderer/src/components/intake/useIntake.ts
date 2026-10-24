// W6-A intake state and calls behind the Start page (W9-E, pages/StartPage.tsx), the one place a plan is made (T2);
// the page only draws it.
import { useEffect, useState } from 'react'
import type { Project } from '../../../../core/orchestration/types'
import type { ScheduleRule } from '../../../../core/types'
import { livePlans, scheduledArgs, type PlanRow, type StartSettings } from '../pages/startLogic'
import { useI18n } from '../../i18n/I18nProvider'
import { formFailure, type OrchDoor } from '../../lib/orchDoor'
import { fileUnderArgs, intakeRequest, type IntakeTab, type PlanningMode } from './intakeRequest'

export interface IntakeOptions {
  door: OrchDoor
  /** T17: the project the plan is for (the title bar's, or the sub-project picked by id); null while none is chosen. */
  project: Project | null
  /** T17: the plan's settings as Start shows them (its delivery the effective one). */
  settings: StartSettings
  /** `sessionId`: the planner's terminal, when the planner started now (not when the plan queued after another or runs
   *  on a schedule). */
  onCreated: (jobId: string, sessionId?: string) => void
  /** W7-B: the description it opens with (the first plan of a new project). */
  initialText?: string
  /** W9-E: files it opens with (a drop on the window). */
  initialFiles?: string[]
  /** W9-E: the tab the frame decides from what is filled in (Start: from its mode and files); the hook's own otherwise. */
  tabOf?: (s: { files: string[]; text: string }) => IntakeTab
}

export function useIntake(o: IntakeOptions) {
  const { door, settings } = o
  const { t } = useI18n()
  const [ownTab, setTab] = useState<IntakeTab>('describe')
  const [text, setText] = useState(o.initialText ?? '')
  const [fixlist, setFixlist] = useState(false)
  const [files, setFiles] = useState<string[]>(o.initialFiles ?? [])
  const [priority, setPriority] = useState(0)
  // T4: who plans, the person with the planner (chat) or the planner alone (auto)
  const [planning, setPlanning] = useState<PlanningMode>('chat')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tab = o.tabOf ? o.tabOf({ files, text }) : ownTab

  const project = o.project
  const projectId = project?.id ?? ''
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
    coordinatorAccount: settings.account,
    concurrency: settings.concurrency,
    effort: settings.effort,
    delivery: settings.delivery,
    replan: settings.replan,
    handsOff: settings.handsOff
  })

  const addPaths = (paths: string[]): void => setFiles((cur) => [...cur, ...paths.filter((p) => p !== '' && !cur.includes(p))])
  const addFiles = (list: FileList | null): void => {
    if (list) addPaths(Array.from(list, (f) => window.api.files.pathForFile(f)))
  }

  /** Plans a made Job: its planner starts, or it queues after another plan (`jobs set --after`: the Host starts its
   *  planner once that one is delivered). The settings were made with the Job (jobs-create), so a queued plan keeps them
   *  too. Returns the planner's session (none when queued), or null after it set the error. */
  const planJob = async (id: string): Promise<{ sessionId?: string } | null> => {
    // Every intake ends with its planner started; a planner that does not start leaves the Job as a draft.
    const planned = await door.command(after ? 'jobs-set' : 'jobs-plan', after ? { id, after } : { id })
    if (planned.status < 400) {
      const sessionId = (planned.body as { sessionId?: unknown } | null)?.sessionId
      return typeof sessionId === 'string' ? { sessionId } : {}
    }
    const why = (planned.body as { error?: unknown } | null)?.error
    setError(`${t('jobs.new.plannerFailed')}${typeof why === 'string' ? `: ${why}` : ''}`)
    return null
  }

  /** T4: jobs-create → jobs-plan; `onCreated` gets the planner's session so Start can open its terminal. T14: with a
   *  `schedule` the Job is made by jobs-create alone, with its rule; no planner opens for it. T17: every setting rides on
   *  jobs-create, and a Job the Host filed under the workspace moves to the sub-project picked (`jobs-set --project`,
   *  on its own, before its planner starts). */
  const create = async (schedule?: ScheduleRule | null): Promise<void> => {
    const args = schedule === undefined ? request?.args : scheduledArgs(request, schedule)
    if (request === null || !args || busy) return
    setBusy(true)
    setError(null)
    try {
      const reply = await door.command(request.cmd, args)
      if (reply.status >= 400) {
        setError(formFailure(reply, t as never, 'jobs.new.failed').message)
        return
      }
      const made = reply.body as { id?: string; projectId?: string }
      const id = made.id
      if (id === undefined) {
        setError(t('jobs.new.failed'))
        return
      }
      const fileUnder = fileUnderArgs({ id, projectId: made.projectId }, projectId)
      if (fileUnder) {
        const moved = await door.command('jobs-set', fileUnder)
        if (moved.status >= 400) {
          setError(formFailure(moved, t as never, 'jobs.new.failed').message)
          return
        }
      }
      if (schedule !== undefined) return o.onCreated(id)
      const planned = await planJob(id)
      if (planned) o.onCreated(id, planned.sessionId)
    } catch {
      setError(t('jobs.new.failed'))
    } finally {
      setBusy(false)
    }
  }

  return {
    tab, setTab, projectId, project, text, setText, fixlist, setFixlist,
    files, setFiles, addFiles, addPaths, priority, setPriority, planning, setPlanning,
    instructions, setInstructions, after,
    setAfter, plans, busy, error, request, create
  }
}

export type Intake = ReturnType<typeof useIntake>
