// Read-cache keys of the plan page's form reads. A Runtime's door answers from the Runtime, so its key carries the
// Runtime id and never meets this computer's.
import type { OrchDoor } from '../../lib/orchDoor'

export const doorKeyOf = (door: Pick<OrchDoor, 'runtimeId' | 'projectKey'>): string => `${door.runtimeId ?? 'local'}:${door.projectKey}`
export const planAccountsKey = (door: Pick<OrchDoor, 'runtimeId' | 'projectKey'>): string => `plan:accounts:${doorKeyOf(door)}`
export const planRunConfigsKey = (door: Pick<OrchDoor, 'runtimeId' | 'projectKey'>, runId: string): string => `plan:runConfigs:${doorKeyOf(door)}:${runId}`
export const planCheckPluginsKey = (door: Pick<OrchDoor, 'runtimeId' | 'projectKey'>): string => `plan:checkPlugins:${doorKeyOf(door)}`
