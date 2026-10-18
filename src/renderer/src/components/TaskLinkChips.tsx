// W2-D GitHub links (SPEC §7): a Task's issue, pull requests and branch, and a plan's one pull request, as chips that
// open GitHub. Live PR state and checks stay with the worktree panel's PrBadge, which the existing PR poller feeds.
import { CircleDot, GitBranch, GitPullRequest } from 'lucide-react'
import type { RunPr, TaskLinks } from '../../../core/orchestration/types'
import { useI18n } from '../i18n/I18nProvider'

const openUrl = (url: string) => (): void => void window.api.system.openExternal(url)

export function TaskLinkChips({ links }: { links?: TaskLinks }): React.JSX.Element | null {
  const { t } = useI18n()
  if (!links) return null
  return (
    <>
      {links.issue && (
        <button className="detail-chip" title={`${t('github.link.issue')} — ${links.issue.url}`} onClick={openUrl(links.issue.url)}>
          <CircleDot size={11} /> #{links.issue.number}
        </button>
      )}
      {links.prs?.map((p) => (
        <button key={p.number} className="detail-chip" title={`${t(`github.state.${p.state}`)} — ${p.url}`} onClick={openUrl(p.url)}>
          <GitPullRequest size={11} /> #{p.number}
        </button>
      ))}
      {links.branch && (
        <span className="detail-chip" title={t('github.link.branch')}>
          <GitBranch size={11} /> {links.branch}
        </span>
      )}
    </>
  )
}

export function RunPrChip({ pr }: { pr?: RunPr }): React.JSX.Element | null {
  const { t } = useI18n()
  if (!pr) return null
  if (pr.url)
    return (
      <button className="jobs-new" title={`${t('github.link.runPr')} — ${pr.url}`} onClick={openUrl(pr.url)}>
        <GitPullRequest size={12} /> {pr.number !== undefined ? `#${pr.number}` : t('github.link.runPr')}
      </button>
    )
  // W7-E (#80): the project has no remote; the chip names the branch that holds the work
  if (pr.note) return <span className="detail-chip" title={pr.note}>{pr.branch ?? pr.note}</span>
  return (
    <span className="detail-chip" title={pr.error}>
      {t('github.link.runPrFailed')}
    </span>
  )
}
