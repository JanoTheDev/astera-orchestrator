// The guild slash commands of the plan workspace, kept this small on purpose: `/plan new`, `/plan status`,
// `/plan approve`. planCommands is what bulkOverwriteGuildCommands registers; parsePlanCommand reads an
// APPLICATION_COMMAND interaction's data back, strictly (it comes off the wire).
import { t, type Lang, type MessageKey } from '../../i18n'
import type { Project } from '../../orchestration/types'
import { cut } from './cards'

const SUB_COMMAND = 1
const STRING = 3
/** Discord's cap on the choices of one option, and on a choice's name and value. */
const CHOICES_MAX = 25
const CHOICE_MAX = 100
/** The longest objective the command takes (Discord allows 6000; a plan's objective is a few lines). */
export const OBJECTIVE_MAX = 4000

export type PlanCommand = { kind: 'new'; objective: string; project?: string } | { kind: 'status' } | { kind: 'approve' }

const w = (lang: Lang, key: string): string => t(lang, `discord.ws.${key}` as MessageKey)

/** The command set. Project choices are offered while the projects fit Discord's 25; past that the option
 *  takes a project's name or id typed in full. */
export function planCommands(projects: readonly Project[], lang: Lang): unknown[] {
  const choices =
    projects.length > 0 && projects.length <= CHOICES_MAX
      ? projects.filter((p) => p.id.length <= CHOICE_MAX).map((p) => ({ name: cut(p.name, CHOICE_MAX), value: p.id }))
      : undefined
  return [
    {
      name: 'plan',
      type: 1,
      description: w(lang, 'cmd.plan'),
      options: [
        {
          type: SUB_COMMAND,
          name: 'new',
          description: w(lang, 'cmd.new'),
          options: [
            { type: STRING, name: 'objective', description: w(lang, 'cmd.objective'), required: true, max_length: OBJECTIVE_MAX },
            { type: STRING, name: 'project', description: w(lang, 'cmd.project'), required: false, ...(choices ? { choices } : {}) }
          ]
        },
        { type: SUB_COMMAND, name: 'status', description: w(lang, 'cmd.status') },
        { type: SUB_COMMAND, name: 'approve', description: w(lang, 'cmd.approve') }
      ]
    }
  ]
}

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null)

/** An APPLICATION_COMMAND interaction's `data` as one of the three commands, or null for anything else. */
export function parsePlanCommand(data: unknown): PlanCommand | null {
  const d = rec(data)
  if (d?.name !== 'plan' || !Array.isArray(d.options)) return null
  const sub = rec(d.options[0])
  if (sub?.type !== SUB_COMMAND) return null
  if (sub.name === 'status' || sub.name === 'approve') return { kind: sub.name }
  if (sub.name !== 'new') return null
  const opts = Array.isArray(sub.options) ? sub.options.map(rec) : []
  const str = (name: string): string | undefined => {
    const v = opts.find((o) => o?.name === name)?.value
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
  }
  const objective = str('objective')
  if (objective === undefined) return null
  const project = str('project')
  return { kind: 'new', objective: objective.slice(0, OBJECTIVE_MAX), ...(project ? { project } : {}) }
}
