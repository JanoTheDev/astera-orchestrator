import type { JobSourceRef } from '../../../core/orchestration/types'

/** What a Job is called where it is shown (plugin 4d): the ticket's title for a Job made from one, since the objective
 *  Astera wrote for it starts "Resolve Linear ENG-101 (…)" and would hide what the ticket is about; the objective
 *  otherwise, as before, and for a Job made before 4d, whose source has no title. The objective stays the Job's text,
 *  and the tooltip. */
export const jobName = (job: { objective: string; source?: JobSourceRef }): string => job.source?.title ?? job.objective
