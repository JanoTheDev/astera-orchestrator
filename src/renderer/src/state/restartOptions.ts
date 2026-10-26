// What Restart on an ended session spawns (useWorkbench.restart). Pure, so the node suite reaches it.
import type { ScheduleConfig, SessionInfo, SessionKind } from '../../../core/types'
import { sessionKindOf } from '../../../core/sessions/kind'

/** Resume the session's own conversation, or start a new one in the same place with the same settings. */
export type RestartHow = 'resume' | 'fresh'

/** T1: a session's account and rolling chain for a respawn (Restart, Reopen): its account first, then the rest of its
 *  chain; no chain, no rolling. */
export const chainOf = (accountId: string, chain: string[] | undefined): { accountIds: string[]; roll: boolean } =>
  chain && chain.length > 0
    ? { accountIds: [accountId, ...chain.filter((id) => id !== accountId)], roll: true }
    : { accountIds: [accountId], roll: false }

export interface RestartSpawn {
  accountIds: string[]
  roll: boolean
  cwd: string
  saveDefault: false
  kind?: SessionKind
  slackNotify?: boolean
  bypassPermissions?: boolean
  rollPrompt?: string
  schedule?: ScheduleConfig
  model?: string
  effort?: string
  replacesSessionId: string
  resumeSessionId?: string
  resumeTranscriptPath?: string
  resumeThreadId?: string
}

/** `transcript` is what sessions.transcript found for a terminal session (null: nothing written, or a chat session).
 *  A terminal session resumes on that CLI conversation, else on the one it was itself resumed from; a chat session on
 *  its protocol thread. Neither known, or `how` is 'fresh': a new conversation. Model and effort ride either way. */
export function restartOptionsOf(
  old: SessionInfo,
  how: RestartHow,
  transcript: { sessionId: string; transcriptPath: string } | null
): RestartSpawn {
  const chat = sessionKindOf(old) === 'chat'
  const cliId = chat ? undefined : (transcript?.sessionId ?? old.resumeSessionId)
  return {
    ...chainOf(old.accountId, old.rollAccountIds),
    cwd: old.cwd,
    saveDefault: false,
    kind: old.kind,
    slackNotify: old.slackNotify,
    bypassPermissions: old.bypassPermissions,
    rollPrompt: old.rollPrompt,
    schedule: old.schedule,
    replacesSessionId: old.id,
    ...(old.model !== undefined ? { model: old.model } : {}),
    ...(old.effort !== undefined ? { effort: old.effort } : {}),
    ...(how === 'resume' && chat && old.threadId !== undefined ? { resumeThreadId: old.threadId } : {}),
    ...(how === 'resume' && cliId !== undefined ? { resumeSessionId: cliId } : {}),
    ...(how === 'resume' && transcript && cliId === transcript.sessionId ? { resumeTranscriptPath: transcript.transcriptPath } : {})
  }
}
