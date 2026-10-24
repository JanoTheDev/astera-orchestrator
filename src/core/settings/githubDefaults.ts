// What a new project does about GitHub, from app-settings.json: whether it gets a repository, and who can see it.
import type { GithubVisibility } from '../projects/create'

export interface GithubDefaults {
  createGithubRepo: boolean
  visibility: GithubVisibility
}

export const GITHUB_DEFAULTS: GithubDefaults = { createGithubRepo: false, visibility: 'private' }

/** The store's narrowing: only `createGithubRepo: true` and `visibility: 'public'` change a default; the file is
 *  user-editable, so anything else reads as the default (a repository nobody asked for, and never a public one). */
export function githubDefaultsOf(value: unknown): GithubDefaults {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return { createGithubRepo: v.createGithubRepo === true, visibility: v.visibility === 'public' ? 'public' : 'private' }
}

/** A value from the renderer, strictly: both fields present and well-formed, else the reason it is refused. */
export function githubDefaultsRefusal(value: unknown): string | null {
  const v = value as Partial<Record<keyof GithubDefaults, unknown>> | null
  if (typeof v !== 'object' || v === null) return 'githubDefaults must be an object'
  if (typeof v.createGithubRepo !== 'boolean') return 'createGithubRepo must be true or false'
  return v.visibility === 'private' || v.visibility === 'public' ? null : 'visibility must be private or public'
}
