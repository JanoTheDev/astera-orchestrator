// The clone dialog's rules, free of React. The Host re-checks all of it (core/projects/create.ts cloneUrlRefusal).
const CLONE_URL = /^(?:(?:https?|ssh|git|file):\/\/[^\s]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+)$/

/** The repository name a URL ends in: `https://host/o/app.git` and `git@host:o/app` are both `app`. */
export const repoNameOf = (url: string): string =>
  (url.trim().replace(/[/\\]+$/, '').split(/[/:\\]/).pop() ?? '').replace(/\.git$/i, '')

/** Where a clone with no destination goes: ~/astera-projects/<name> (the Host's own default, shown as a hint). */
export const defaultClonePath = (url: string, home: string): string =>
  `${home.replace(/[/\\]+$/, '')}/astera-projects/${repoNameOf(url) || 'project'}`

/** What is wrong with the form, as a message key, or null when it can be sent. Empty fields are not an error yet. */
export function cloneProblem(url: string, dest: string): 'onboarding.clone.invalidUrl' | 'onboarding.clone.invalidDest' | null {
  if (url.trim() !== '' && !CLONE_URL.test(url.trim())) return 'onboarding.clone.invalidUrl'
  const d = dest.trim()
  return d !== '' && !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(d) ? 'onboarding.clone.invalidDest' : null
}

/** Clone can be pressed: a URL that passes, nothing else wrong, and no clone running. */
export const canClone = (url: string, dest: string, busy: boolean): boolean => !busy && url.trim() !== '' && cloneProblem(url, dest) === null
