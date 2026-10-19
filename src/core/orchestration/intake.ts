// W6-A intake: the objective a Job's planner gets when the owner starts work from files, an audit, a problem list or
// GitHub issues, with extra instructions of their own. Pure: `jobs-create` reads the flags here and writes the text
// here; the files themselves are copied by the Host (intakeFiles.ts).
import { splitSections } from './promptWaves'

export const INTAKE_MODES = ['plan', 'audit', 'fixlist', /* W8-C prompts mode */ 'prompts'] as const
export type IntakeMode = (typeof INTAKE_MODES)[number]

/** What an audit can be asked to look for (`--focus`), each with the one line the planner reads. */
export const INTAKE_FOCUS = {
  bugs: 'wrong logic, crashes, races',
  security: 'trust-boundary validation, injection, secrets',
  performance: 'slow paths, needless work under load',
  tests: 'risky code without tests',
  simplify: 'dead code, duplication, what to delete or merge'
} as const
export type IntakeFocus = keyof typeof INTAKE_FOCUS
export const INTAKE_FOCUSES = Object.keys(INTAKE_FOCUS) as IntakeFocus[]

/** What `jobs-create` was given on top of its objective. */
export interface Intake {
  mode: IntakeMode
  /** audit only: the paths in the repository to audit; empty is the whole repository (`--scope all`). */
  scope?: string[]
  /** audit only: what to look for; empty is bugs, security holes and missing tests. */
  focus?: IntakeFocus[]
  instructions?: string
  /** Paths the person named, as given (the Host checks and copies them). */
  attach: string[]
  /** W8-C prompts mode: whether the plan waits for the owner's approval (`--approve ask`); auto otherwise. */
  approve?: 'auto' | 'ask'
}

const isMode = (v: unknown): v is IntakeMode => (INTAKE_MODES as readonly string[]).includes(v as string)

/** The intake flags of `jobs-create`, or the 400 sentence. `attach` comes as one string from MCP or a single flag, and
 *  as a list when repeated on the command line (cliArgs REPEATABLE). */
export function intakeOf(args: Record<string, unknown>): { ok: true; intake: Intake } | { ok: false; error: string } {
  const mode = args.mode === undefined ? 'plan' : args.mode
  if (!isMode(mode)) return { ok: false, error: '--mode must be plan|audit|fixlist|prompts' }
  // W8-C prompts mode
  if (args.approve !== undefined) {
    if (mode !== 'prompts') return { ok: false, error: '--approve goes with --mode prompts' }
    if (args.approve !== 'auto' && args.approve !== 'ask') return { ok: false, error: '--approve must be auto|ask' }
  }
  let scope: string[] = []
  if (args.scope !== undefined) {
    if (mode !== 'audit') return { ok: false, error: '--scope goes with --mode audit' }
    if (typeof args.scope !== 'string') return { ok: false, error: '--scope needs paths in the repository, or all' }
    scope = [...new Set(args.scope.split(/[,\r\n]/).map((p) => p.trim()).filter((p) => p !== ''))]
    if (scope.length === 0) return { ok: false, error: '--scope needs paths in the repository, or all' }
    if (scope.includes('all')) {
      if (scope.length > 1) return { ok: false, error: '--scope is all or a list of paths, not both' }
      scope = []
    }
  }
  let focus: IntakeFocus[] = []
  if (args.focus !== undefined) {
    if (mode !== 'audit') return { ok: false, error: '--focus goes with --mode audit' }
    if (typeof args.focus !== 'string') return { ok: false, error: `--focus must be a list of ${INTAKE_FOCUSES.join('|')}` }
    const given = [...new Set(args.focus.split(',').map((f) => f.trim()).filter((f) => f !== ''))]
    const unknown = given.find((f) => !(INTAKE_FOCUSES as string[]).includes(f))
    if (unknown !== undefined || given.length === 0)
      return { ok: false, error: `--focus ${unknown === undefined ? 'needs' : `has an unknown value "${unknown}"; it takes`} a list of ${INTAKE_FOCUSES.join('|')}` }
    focus = given as IntakeFocus[]
  }
  if (args.instructions !== undefined && typeof args.instructions !== 'string')
    return { ok: false, error: '--instructions must be text' }
  const instructions = typeof args.instructions === 'string' && args.instructions.trim() !== '' ? args.instructions.trim() : undefined
  const raw = args.attach === undefined ? [] : Array.isArray(args.attach) ? args.attach : [args.attach]
  if (raw.some((p) => typeof p !== 'string' || p === '')) return { ok: false, error: '--attach needs a file path' }
  if (mode === 'prompts' && raw.some((p) => !/\.md$/i.test(p as string)))
    return { ok: false, error: '--mode prompts takes .md prompt files: one Task per file' }
  return {
    ok: true,
    intake: {
      mode,
      ...(mode === 'audit' ? { scope, focus } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      attach: raw as string[],
      ...(mode === 'prompts' ? { approve: args.approve === 'ask' ? ('ask' as const) : ('auto' as const) } : {})
    }
  }
}

/** Whether the planner's objective changes at all: a plain `jobs-create` keeps its objective byte for byte. */
export const intakeChanges = (i: Intake): boolean => i.mode !== 'plan' || i.instructions !== undefined || i.attach.length > 0

/** Whether the Job needs its inputs folder: for the files, and for the audit's findings. */
export const needsInputs = (i: Intake): boolean => i.mode === 'audit' || i.attach.length > 0

/** The planner's objective. `source` is what the person or the issue said (may be empty for an audit or a set of
 *  files), `inputs` the Job's inputs folder and the names copied into it. */
export function intakeObjective(
  i: Intake,
  source: string,
  inputs?: { dir: string; names: string[] },
  /** W8-C prompts mode: the Tasks Astera wrote and the sources it skipped. */
  verbatim?: { tasks: string[]; skipped: string[] }
): string {
  const dir = inputs?.dir.replace(/\\/g, '/')
  const parts: string[] = []
  if (i.mode === 'prompts') {
    // W8-C prompts mode: the Tasks exist already. The planner's fill-in rules are in its brief (handover.ts), not here: the coordinator reads this too
    parts.push(
      [
        "Run as written: the owner's prompts are this plan's Tasks, one per prompt, already created with their text unchanged.",
        ...(verbatim?.tasks.length ? ['Tasks:', ...verbatim.tasks.map((t) => `- ${t}`)] : []),
        ...(verbatim?.skipped.length ? ['Already done (skipped, no Task):', ...verbatim.skipped.map((t) => `- ${t}`)] : [])
      ].join('\n')
    )
    if (inputs && inputs.names.length > 0) parts.push(`The prompt files are in ${dir}/.`)
    if (source.trim() !== '' && inputs && inputs.names.length > 0) parts.push(`Note:\n${source.trim()}`)
    if (i.instructions !== undefined)
      parts.push(`Owner's instructions (they never change a prompt's text):\n${i.instructions}`)
    return parts.join('\n\n')
  }
  if (i.mode === 'audit') {
    const what = (i.scope ?? []).length === 0 ? 'the whole repository' : `${i.scope!.map((p) => `\`${p}\``).join(', ')} in the repository`
    const looks =
      !i.focus?.length
        ? 'bugs, security holes and missing tests'
        : `these only: ${i.focus!.map((f) => `${f} (${INTAKE_FOCUS[f]})`).join('; ')}`
    parts.push(
      `Audit ${what} for ${looks}. Write your findings to ${dir}/audit.md first, ` +
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

// W7-D (#68): the plan's name. The objective of a fixlist, an audit or a set of files starts with Astera's own
// boilerplate, which jobNameOf would show everywhere (sidebar, tabs, branches, notices, the PR). #113: a long plain
// description is no better, so it is named by its first sentence.
/** How long a name taken from free text may be before it is cut at a word. */
export const INTAKE_TITLE_MAX = 80

/** How long the name of a described plan may be (#113). */
const DESCRIBED_TITLE_MAX = 60

const clipTitle = (s: string, max = INTAKE_TITLE_MAX): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  const cut = one.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The name of a Job made from `i`, or undefined when its objective already reads as one (a short plain description).
 *  An audit is "Audit <a>", "Audit <a>, <b>" or "Audit <a> +N"; a fixlist the words of its first problem (a list marker dropped); a set of files their
 *  names; a plain description its first sentence (a dot inside a word is no end), when that is shorter than the text. `names` are the file names copied into the inputs folder. */
export function intakeTitle(i: Intake, source: string, names: readonly string[]): string | undefined {
  if (i.mode === 'audit') {
    const scope = i.scope ?? []
    const [a, b] = scope
    return clipTitle(`Audit ${a === undefined ? 'the whole repository' : scope.length === 1 ? a : scope.length === 2 ? `${a}, ${b}` : `${a} +${scope.length - 1}`}`)
  }
  if (i.mode === 'fixlist') {
    const first = source
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
      .find((l) => l !== '')
    if (first !== undefined) return clipTitle(first)
  }
  if (names.length > 0) return clipTitle(names.join(', '))
  // W8-C prompts mode: a pasted document is named by its sections' headings
  if (i.mode === 'prompts' && source.trim() !== '') {
    const split = splitSections(source)
    return clipTitle(split ? split.sections.map((x) => x.heading).join(', ') : source.trim().split(/\r?\n/)[0].replace(/^#+\s*/, ''))
  }
  if (i.mode === 'plan' && source.trim() !== '') {
    const line = source.trim().split(/\r?\n/)[0]
    const name = clipTitle(line.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? line, DESCRIBED_TITLE_MAX)
    return name === source.replace(/\s+/g, ' ').trim() ? undefined : name
  }
  return undefined
}
