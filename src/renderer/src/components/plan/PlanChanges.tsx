// The Changes tab of the plan's Activity (moved out of pages/PlanPage.tsx): what the whole plan changed; and the Merge
// button and the plan's pull request, which the header shows.
import { useEffect, useState } from 'react'
import type { JobRow, WorktreeListItem } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { ChangedFilesBlock } from '../ChangedFilesBlock'
import { ReviewView } from '../review/ReviewView'
import { RunPrChip } from '../TaskLinkChips'
import { Button, Icon } from '../ui'
import { planOwnerOfPath } from '../worktrees/worktreeView'
import { RUN_MERGE } from './planPage'
import type { PlanPageState } from './usePlanPage'

/** Merge and the PR chip, for the plan's header. */
export function PlanMergeActions({ p, run }: { p: PlanPageState; run: JobRow | undefined }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <>
      {/* 워커의 일을 프로젝트 폴더로 가져오는 자리. **예약 템플릿에는 없다** — 템플릿은
          돌지 않으므로 합칠 것이 없다(회차의 워크트리는 완료되면 앱이 걷는다). 워크트리를
          쓰지 않은 Run 에도 없다 — 삭제 모달의 병합 체크박스와 같은 근거를 쓴다. */}
      {run !== undefined && run.schedule === undefined && (run.worktrees ?? []).length > 0 && (
        <Button
          size="sm"
          icon={<Icon name="merge" size={14} />}
          disabled={p.lockedReason !== undefined || p.busy === RUN_MERGE}
          title={p.lockedReason ?? t('jobs.run.mergeHint', { count: (run.worktrees ?? []).length })}
          onClick={() => void p.mergeRunNow()}
        >
          {t('jobs.run.merge')}
        </Button>
      )}
      {/* W2-D: the plan's one pull request, beside the local Merge, which stays */}
      {run?.pr && <RunPrChip pr={run.pr} retry={p.lockedReason === undefined ? { door: p.door, runId: run.foldedRunId ?? run.id } : undefined} />}
    </>
  )
}

/** What the whole plan changed, from git where it runs (Phase 10). Merge and the PR stand in the plan's header (T8).
 *  T7: above the file list, the review (change map, code, hunk actions) of the plan's own folder, when this computer
 *  has it registered. */
export function PlanChanges({ door, runId, run }: { door: OrchDoor; runId: string; run?: JobRow }): React.JSX.Element {
  const folder = useRunFolder(run)
  return (
    <>
      {run && folder && <ReviewView cwd={folder.path} base={folder.baseRef} owner={{ plan: run }} door={door} />}
      <ChangedFilesBlock door={door} runId={runId} />
    </>
  )
}

/** The Run's own integration folder (the worktree no Task's branch is on), from this computer's worktree registry. */
export async function findRunFolder(run: JobRow): Promise<WorktreeListItem | null> {
  const items = await window.api.worktrees.list()
  return items.find((w) => w.status === 'ok' && planOwnerOfPath([run], w)?.planFolder === true) ?? null
}

export function useRunFolder(run: JobRow | undefined): WorktreeListItem | null {
  const [folder, setFolder] = useState<WorktreeListItem | null>(null)
  const key = (run?.worktrees ?? []).join('\n')
  useEffect(() => {
    setFolder(null)
    if (!run || key === '') return
    let live = true
    void findRunFolder(run).then(
      (found) => live && setFolder(found),
      () => undefined
    )
    return () => {
      live = false
    }
    // the row changes on every snapshot; the folders it names are what matters
  }, [run?.id, key])
  return folder
}
