// IPC for Settings › Agents, the `prompts.*` channels behind window.api.prompts: the owner's custom
// instructions per role (core/prompts/ownerInstructions.ts). Registered from index.ts beside registerExtensionsIpc.

import type { IpcMain } from 'electron'
import { buildHandoverPrompt, buildPlannerBrief } from '../core/orchestration/handover'
import { buildReviewSpecFile, buildSpecFile } from '../core/orchestration/exec/coordinator'
import { isPromptRole, list, read, reset, write } from '../core/prompts/ownerInstructions'
import { sessionContextLines } from '../core/sessions/sessionContext'
import type { PromptRole } from '../core/types'

/** The built-in text of a role with placeholder ids, so the editor can show what the owner's text is appended to. */
export function previewOf(role: PromptRole): string {
  const ids = { taskId: 'tsk_example', dispatchId: 'dsp_example' }
  switch (role) {
    case 'session':
      return sessionContextLines({}, null).join('\n')
    case 'planner':
      return buildPlannerBrief({ jobId: 'job_example', objective: '<the plan\'s objective>', repoRoot: '<repository>', accountId: 'acc_example', concurrency: 2 })
    case 'coordinator':
      return buildHandoverPrompt({ runId: 'run_example', objective: '<the plan\'s objective>', concurrency: 2, taskCount: 3, jobId: 'job_example', accountId: 'acc_example' })
    case 'worker':
      return buildSpecFile({ title: '<task title>', spec: '<the task\'s prompt>', ...ids, committing: true })
    case 'reviewer':
      return buildReviewSpecFile({ title: '<task title>', spec: '<the task\'s prompt>', ...ids, validated: true })
  }
}

export function registerPromptsIpc(ipcMain: IpcMain, deps: { profileDir: string }): void {
  ipcMain.handle('prompts.list', () => list(deps.profileDir))
  ipcMain.handle('prompts.get', (_e, r: unknown) => (isPromptRole(r) ? read(deps.profileDir, r) : ''))
  ipcMain.handle('prompts.set', (_e, r: unknown, text: unknown) => write(deps.profileDir, r, text))
  ipcMain.handle('prompts.reset', (_e, r: unknown) => reset(deps.profileDir, r))
  ipcMain.handle('prompts.preview', (_e, r: unknown) => (isPromptRole(r) ? previewOf(r) : ''))
}
