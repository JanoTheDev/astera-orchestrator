import type { ActivityId } from '../../../../core/ui/pages'

/** Most side bar views kept mounted at once, the current one included. */
export const MAX_KEPT_VIEWS = 4

/** The views to keep mounted after visiting `next`: it first, then the most recent of `prev`, at most `max`. */
export function keepViews(prev: readonly ActivityId[], next: ActivityId, max = MAX_KEPT_VIEWS): ActivityId[] {
  return [next, ...prev.filter((id) => id !== next)].slice(0, max)
}
