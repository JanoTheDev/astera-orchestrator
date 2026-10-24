// What a Job is called where it is shown (plugin 4d): the ticket's title for a Job made from one, since the objective
// Astera wrote for it starts "Resolve Linear ENG-101 (...)" and hides what the ticket is about; its objective otherwise,
// and for a Job made before 4d, whose source has no title. The app's cards and detail, its delete question, the CLI's
// `jobs list --human`, How It Works and the notifications all name a Job by this. The objective stays the Job's text,
// and what an agent is given.
// A title a person gave the plan (`jobs rename`, W1-C) comes first.
import type { JobSourceRef } from './types'

export const jobNameOf = (job: { objective: string; source?: JobSourceRef; title?: string }): string =>
  job.title ?? job.source?.title ?? job.objective

/** How long a summary of an untitled plan's objective may run before it is cut at a word. */
const SUMMARY_MAX = 60

/** A plan's name on a screen with one line for it (the Main plan): jobNameOf, except that an untitled plan's objective,
 *  often a long pasted prompt, is cut to its first sentence or line and then to SUMMARY_MAX characters at a word. */
export function jobDisplayName(job: { objective: string; source?: JobSourceRef; title?: string }): string {
  if (job.title !== undefined || job.source?.title !== undefined) return jobNameOf(job)
  const whole = job.objective.trim()
  const first = whole.split(/\n|(?<=[.!?])\s/)[0].replace(/[.!?]+$/, '').trim() || whole
  if (first.length <= SUMMARY_MAX) return first
  const space = first.lastIndexOf(' ', SUMMARY_MAX)
  return `${(space > 0 ? first.slice(0, space) : first.slice(0, SUMMARY_MAX)).trimEnd()}…`
}
