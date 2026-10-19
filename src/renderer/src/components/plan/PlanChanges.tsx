// The Changes section of the plan page (moved out of pages/PlanPage.tsx): Merge and the plan's pull request, then what
// the whole plan changed. The Merge row is shared with the Overview.
import type { JobRow } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { ChangedFilesBlock } from '../ChangedFilesBlock'
import { RunPrChip } from '../TaskLinkChips'
import { GitMerge } from 'lucide-react'
import { Button } from '../ui'
import { RUN_MERGE } from './planPage'
import type { PlanPageState } from './usePlanPage'

/** Merge and the PR chip, for the row above a section's content. */
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
          icon={<GitMerge size={14} />}
          disabled={p.lockedReason !== undefined || p.busy === RUN_MERGE}
          title={p.lockedReason ?? t('jobs.run.mergeHint', { count: (run.worktrees ?? []).length })}
          onClick={() => void p.mergeRunNow()}
        >
          {t('jobs.run.merge')}
        </Button>
      )}
      {/* W2-D: the plan's one pull request, beside the local Merge, which stays */}
      {run?.pr && <RunPrChip pr={run.pr} />}
    </>
  )
}

export function PlanChanges({ p, run, door, runId }: { p: PlanPageState; run: JobRow | undefined; door: OrchDoor; runId: string }): React.JSX.Element {
  return (
    <>
      {!p.authoringOpen && (
        <div className="detail-graph-head">
          <PlanMergeActions p={p} run={run} />
        </div>
      )}
      {/* W9-C Changes: what the whole plan changed, from git where it runs (Phase 10) */}
      <ChangedFilesBlock door={door} runId={runId} />
    </>
  )
}
