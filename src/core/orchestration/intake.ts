// W6-A intake: the objective a Job's planner gets when the owner starts work from files, an audit, a problem list or
// GitHub issues, with extra instructions of their own. Pure: `jobs-create` reads the flags here and writes the text
// here; the files themselves are copied by the Host (intakeFiles.ts).

export const INTAKE_MODES = ['plan', 'audit', 'fixlist'] as const
export type IntakeMode = (typeof INTAKE_MODES)[number]

/** What `jobs-create` was given on top of its objective. */
export interface Intake {
  mode: IntakeMode
  /** audit only: a path in the repository, or 'all'. */
  scope?: string
  instructions?: string
  /** Paths the person named, as given (the Host checks and copies them). */
  attach: string[]
}

const isMode = (v: unknown): v is IntakeMode => (INTAKE_MODES as readonly string[]).includes(v as string)

/** The intake flags of `jobs-create`, or the 400 sentence. `attach` comes as one string from MCP or a single flag, and
 *  as a list when repeated on the command line (cliArgs REPEATABLE). */
export function intakeOf(args: Record<string, unknown>): { ok: true; intake: Intake } | { ok: false; error: string } {
  const mode = args.mode === undefined ? 'plan' : args.mode
  if (!isMode(mode)) return { ok: false, error: '--mode must be plan|audit|fixlist' }
  let scope: string | undefined
  if (args.scope !== undefined) {
    if (mode !== 'audit') return { ok: false, error: '--scope goes with --mode audit' }
    if (typeof args.scope !== 'string' || args.scope.trim() === '' || /[\r\n]/.test(args.scope))
      return { ok: false, error: '--scope needs one line: a path in the repository, or all' }
    scope = args.scope.trim()
  }
  if (args.instructions !== undefined && typeof args.instructions !== 'string')
    return { ok: false, error: '--instructions must be text' }
  const instructions = typeof args.instructions === 'string' && args.instructions.trim() !== '' ? args.instructions.trim() : undefined
  const raw = args.attach === undefined ? [] : Array.isArray(args.attach) ? args.attach : [args.attach]
  if (raw.some((p) => typeof p !== 'string' || p === '')) return { ok: false, error: '--attach needs a file path' }
  return {
    ok: true,
    intake: {
      mode,
      ...(mode === 'audit' ? { scope: scope ?? 'all' } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      attach: raw as string[]
    }
  }
}

/** Whether the planner's objective changes at all: a plain `jobs-create` keeps its objective byte for byte. */
export const intakeChanges = (i: Intake): boolean => i.mode !== 'plan' || i.instructions !== undefined || i.attach.length > 0

/** Whether the Job needs its inputs folder: for the files, and for the audit's findings. */
export const needsInputs = (i: Intake): boolean => i.mode === 'audit' || i.attach.length > 0

/** The planner's objective. `source` is what the person or the issue said (may be empty for an audit or a set of
 *  files), `inputs` the Job's inputs folder and the names copied into it. */
export function intakeObjective(i: Intake, source: string, inputs?: { dir: string; names: string[] }): string {
  const dir = inputs?.dir.replace(/\\/g, '/')
  const parts: string[] = []
  if (i.mode === 'audit') {
    const what = i.scope === undefined || i.scope === 'all' ? 'the whole repository' : `\`${i.scope}\` in the repository`
    parts.push(
      `Audit ${what} for bugs, security holes and missing tests. Write your findings to ${dir}/audit.md first, ` +
        'one finding per entry with its file and why it matters. Then plan Tasks that fix them; each Task names the findings it fixes.'
    )
  } else if (i.mode === 'fixlist') {
    parts.push(
      'The source below is a list of problems. Plan one or more Tasks per problem, and name in each Task which problem(s) it closes. ' +
        'Every problem is closed by some Task.'
    )
  }
  if (inputs && inputs.names.length > 0)
    parts.push(
      [
        `Read every file in ${dir}/ first (PDFs over 20 pages in page ranges):`,
        ...inputs.names.map((n) => `- ${dir}/${n}`)
      ].join('\n')
    )
  const src = source.trim()
  if (src !== '') parts.push(i.mode === 'plan' && parts.length === 0 ? src : `Source:\n${src}`)
  else if (i.mode === 'plan') parts.push('Plan the work the files above describe.')
  if (i.instructions !== undefined)
    parts.push(`Owner's instructions (they win over the source when the two conflict):\n${i.instructions}`)
  return parts.join('\n\n')
}
