// English · prs area. Which files each area serves: ../README.md.
import type { prs as ko } from '../ko/prs'

export const prs: Record<keyof typeof ko, string> = {
  'prs.refresh': 'Refresh',
  'prs.filter': 'Filter by title, author or branch',
  'prs.noProject': 'Pick a project to see its pull requests.',
  'prs.loading': 'Loading pull requests…',
  'prs.empty': 'No open pull requests.',
  'prs.noMatch': 'No pull request matches the filter.',
  'prs.notInstalled': 'The GitHub CLI (gh) is not installed. Install it, then restart the app.',
  'prs.notAuthenticated': 'You are not signed in to GitHub.',
  'prs.openSettings': 'Open GitHub settings',
  'prs.noRemote': 'This project has no GitHub remote.',
  'prs.error': 'Could not load pull requests: {detail}',
  'prs.draft': 'Draft',
  'prs.review': 'Review with AI',
  'prs.github': 'Open on GitHub',
  'prs.merge': 'Merge',
  'prs.notMergeable': 'Cannot be merged yet. Check conflicts, required checks and reviews.',
  'prs.alreadyMerged': 'Already merged or closed.',
  'prs.updated': '{age} ago',
  'prs.menu': 'Pull request actions',
  'prs.list': 'Pull requests'
}
