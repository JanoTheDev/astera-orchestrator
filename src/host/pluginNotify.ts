// The wording the Host hands its notification plugins (plugin Phase 3 N10): in the language the app is set to when the
// notification is made, a Job by its objective as the state holds it then. The state is waited for (3c final review
// M3): a Host that starts hands its plugins their backlog before anything has loaded it, and the empty state before
// the load would title every Job by its id, as if it were gone.
import type { Lang } from '../core/i18n'
import type { AsteraEvent } from '../core/publicContract'
import { isNotificationKind, notificationOf, type PluginNotification } from '../core/plugins/notifications'
import { jobNameOf } from '../core/orchestration/jobName'
import type { JobSourceRef } from '../core/orchestration/types'

export function hostNotifier(d: {
  /** The language the app is set to, read now. */
  lang(): Promise<Lang>
  orch: {
    /** Settles once the state is in memory. */
    ready(): Promise<void>
    state(): { jobs: ReadonlyArray<{ id: string; objective: string; source?: JobSourceRef }> }
  }
}): (event: AsteraEvent) => Promise<PluginNotification | null> {
  return async (event) => {
    if (!isNotificationKind(event.type)) return null
    await d.orch.ready()
    const lang = await d.lang()
    // A Job is titled as its card names it (plugin 4d review M3): a ticket's title for a Job made from one
    return notificationOf(event, {
      lang,
      objectiveOf: (id) => {
        const job = d.orch.state().jobs.find((j) => j.id === id)
        return job === undefined ? undefined : jobNameOf(job)
      }
    })
  }
}
