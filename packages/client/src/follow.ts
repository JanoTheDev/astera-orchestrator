// Following a Run's timeline (`runs-follow`): which event is which across polls.
import type { RunEvent } from './types.js'

/** Which event this is, across polls. `sourceId` is unique within a kind only: a question opens and resolves under
 *  one id, and a worker's stop and resume share `<dispatchId>:<n>`. */
export const eventKey = (e: Pick<RunEvent, 'kind' | 'sourceId'>): string => `${e.kind}:${e.sourceId}`
