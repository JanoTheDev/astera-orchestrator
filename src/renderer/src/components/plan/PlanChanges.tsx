// How the plan's work reaches the project: the local Merge and the plan's pull request. Shown in the Overview and
// Changes sections; the command itself is usePlanActions' mergeRunNow (it asks first).
import type { JobRow } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { RunPrChip } from '../TaskLinkChips' // W2-D GitHub links
import { GitMerge } from 'lucide-react'
import { Button } from '../ui'

export function PlanMerge({
  run,
  lockedReason,
  merging,
  onMerge
}: {
  run: JobRow | undefined
  lockedReason: string | undefined
  merging: boolean
  onMerge: () => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  if (run === undefined) return null
  const worktrees = (run.worktrees ?? []).length
  return (
    <>
      {/* 워커의 일을 프로젝트 폴더로 가져오는 자리. **예약 템플릿에는 없다** — 템플릿은
          돌지 않으므로 합칠 것이 없다(회차의 워크트리는 완료되면 앱이 걷는다). 워크트리를
          쓰지 않은 Run 에도 없다 — 삭제 모달의 병합 체크박스와 같은 근거를 쓴다. */}
      {run.schedule === undefined && worktrees > 0 && (
        <Button
          size="sm"
          icon={<GitMerge size={14} />}
          disabled={lockedReason !== undefined || merging}
          title={lockedReason ?? t('jobs.run.mergeHint', { count: worktrees })}
          onClick={onMerge}
        >
          {t('jobs.run.merge')}
        </Button>
      )}
      {/* W2-D: the plan's one pull request, beside the local Merge, which stays */}
      {run.pr && <RunPrChip pr={run.pr} />}
    </>
  )
}
