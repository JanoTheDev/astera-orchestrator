// W2-D GitHub links (SPEC §7): a Task's issue, pull requests and branch, and a plan's one pull request, as chips that
// open GitHub. Live PR state and checks stay with the worktree panel's PrBadge, which the existing PR poller feeds.
import type { RunPr, TaskLinks } from '../../../core/orchestration/types'
import { useI18n } from '../i18n/I18nProvider'
import { openPr } from '../lib/jobActions'
import type { OrchDoor } from '../lib/orchDoor'
import { toast } from '../lib/toast'
import { Button, Icon } from './ui'

const openUrl = (url: string) => (): void => void window.api.system.openExternal(url)

export function TaskLinkChips({ links }: { links?: TaskLinks }): React.JSX.Element | null {
  const { t } = useI18n()
  if (!links) return null
  return (
    <>
      {links.issue && (
        <Button size="sm" variant="ghost" icon={<Icon name="issue" size={14} />} title={`${t('github.link.issue')} — ${links.issue.url}`} onClick={openUrl(links.issue.url)}>
          #{links.issue.number}
        </Button>
      )}
      {links.prs?.map((p) => (
        <Button key={p.number} size="sm" variant="ghost" icon={<Icon name="pullRequest" size={14} />} title={`${t(`github.state.${p.state}`)} — ${p.url}`} onClick={openUrl(p.url)}>
          #{p.number}
        </Button>
      ))}
      {links.branch && (
        <span className="detail-chip" title={t('github.link.branch')}>
          <Icon name="branch" size={14} /> {links.branch}
        </span>
      )}
    </>
  )
}

/** `retry`: the plan's run and a door, when this computer can open the pull request again. */
export function RunPrChip({ pr, retry }: { pr?: RunPr; retry?: { door: OrchDoor; runId: string } }): React.JSX.Element | null {
  const { t } = useI18n()
  if (!pr) return null
  if (pr.url)
    return (
      <Button size="sm" variant="ghost" icon={<Icon name="pullRequest" size={14} />} title={`${t('github.link.runPr')} — ${pr.url}`} onClick={openUrl(pr.url)}>
        {pr.number !== undefined ? `#${pr.number}` : t('github.link.runPr')}
      </Button>
    )
  // W7-E (#80): the project has no remote; the chip names the branch that holds the work
  if (pr.note) return <span className="detail-chip" title={pr.note}>{pr.branch ?? pr.note}</span>
  return (
    <>
      <span className="detail-chip" title={pr.error}>
        {t('github.link.runPrFailed')}
      </span>
      {retry && (
        <Button size="sm" variant="ghost" icon={<Icon name="rerun" size={14} />} onClick={() => void openPr(retry.door, retry.runId, { t: t as never, error: toast.error })}>
          {t('plan.summary.retryPr')}
        </Button>
      )}
    </>
  )
}
