// W3-B: free text → one intent through the `coordinator` role model (W1-A), as a one-shot read-only CLI call. The
// run itself is How It Works' (understanding/agent.ts: `-p`, plan mode, no write tools, no MCP, no saved session),
// reused rather than copied; only the model differs, and it is the coordinator's, never the planner's.
import type { Account, Provider } from '../types'
import type { ProviderDescriptor } from '../providers/descriptor'
import { providerOf } from '../providers/meta'
import { resolveRoleModel, type RoleModelSettings } from '../orchestration/roleModels'
import { runAgent } from '../understanding/agent'
import { readIntent, type Parsed } from './types'

export async function parseWithCoordinator(a: {
  account: Account
  descriptors: Record<Provider, ProviderDescriptor>
  roleModels: RoleModelSettings
  cwd: string
  prompt: string
  run?: typeof runAgent
}): Promise<Parsed> {
  const model = resolveRoleModel(a.roleModels, undefined, 'coordinator', providerOf(a.account))
  const r = await (a.run ?? runAgent)({ account: a.account, descriptors: a.descriptors, generator: { model }, cwd: a.cwd, prompt: a.prompt })
  if (!r.ok) return r
  const intent = readIntent(r.value)
  return intent ? { ok: true, intent, ...(model ? { model } : {}) } : { ok: false, reason: 'the coordinator did not answer with a command' }
}
