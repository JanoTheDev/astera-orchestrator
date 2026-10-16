// What a Job is called where it is shown (plugin 4d): the ticket's title for a Job made from one, since the objective
// Astera wrote for it starts "Resolve Linear ENG-101 (...)" and hides what the ticket is about; its objective otherwise,
// and for a Job made before 4d, whose source has no title. The app's cards and detail, its delete question, the CLI's
// `jobs list --human`, How It Works and the notifications all name a Job by this. The objective stays the Job's text,
// and what an agent is given.
import type { JobSourceRef } from './types'

export const jobNameOf = (job: { objective: string; source?: JobSourceRef }): string => job.source?.title ?? job.objective
