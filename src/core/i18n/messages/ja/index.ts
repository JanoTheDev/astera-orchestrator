
/** Japanese. Partial by design: a key that is not here falls back to English, then to Korean, so a new
 *  string can ship before its translation does. */
import type { Catalog } from '../../index'
import { common } from './common'
import { core } from './core'
import { shell } from './shell'
import { start } from './start'
import { plans } from './plans'
import { plan } from './plan'
import { agents } from './agents'
import { files } from './files'
import { worktrees } from './worktrees'
import { accounts } from './accounts'
import { settings } from './settings'
import { integrations } from './integrations'
import { onboarding } from './onboarding'
import { inbox } from './inbox'
import { update } from './update'
import { errors } from './errors'
import { overlays } from './overlays'
import { tools } from './tools'
import { history } from './history'
import { about } from './about'
import { crash } from './crash'
import { help } from './help'
import { misc } from './misc'

export const ja: Catalog = {
  ...common,
  ...core,
  ...shell,
  ...start,
  ...plans,
  ...plan,
  ...agents,
  ...files,
  ...worktrees,
  ...accounts,
  ...settings,
  ...integrations,
  ...onboarding,
  ...inbox,
  ...update,
  ...errors,
  ...overlays,
  ...tools,
  ...history,
  ...about,
  ...crash,
  ...help,
  ...misc
}
