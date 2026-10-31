// `astera --help` — the three levels of usage text, and the one table they are printed from.
//
// **The table is hand-kept, and it cannot be derived.** The flags a command takes are declared
// nowhere. Most are read ad hoc inside `handleCommand`'s `case` for that command (`str(args.id)`,
// `args.ready === true`, `typeof args.timeoutMs === 'number'`), and the rest are read in the CLI
// before the call is ever made: `browser js --file` is opened in run.ts, and `--skills-dir` is read
// by `resolveGuidePath` there. `parseArgs` only knows how to turn a token into a value, never which
// command wanted it. There is no declaration to generate from, so the flags below are written by
// hand. That is the risk this file has to manage, because a usage table that has drifted from the
// real flags is worse than no usage table at all: a person acts on it.
//
// **Two things hold it honest, and they hold different halves.**
//
// 1. *The command set* is held by the compiler. `PublicCommand` is derived from `NOUNS`
//    (cliArgs.ts) plus the standalone commands, and `USAGE` is a `Record` over it — a verb added to
//    `NOUNS` stops this file compiling until its usage exists, and a verb removed leaves an excess
//    property. This is the shape `cliPublic.ts` already uses to pin the public field allowlist.
// 2. *The flags* are held by cliUsage.test.ts against the `## Command reference` block of
//    `docs/cli.md`. Nothing can check a flag against the server, so what is checked is that the
//    published document and this table say the same thing: which flags a command has, whether each
//    takes a value, and which are required. Prose and placeholder names are not compared — the two
//    are written for different readers.
//
// **What neither holds, one:** that a flag listed here is a flag the program actually reads. A flag
// added to a `case` and to this table but not to the document fails the test; added to none of the
// three it stays invisible. Only review covers that gap. `help`'s `--skills-dir` is a live example,
// deliberately (see its entry).
//
// **What neither holds, two:** that this set *is* the public surface. The compiler pins
// `USAGE` to `NOUNS` plus `TOP` plus `BROWSER_VERBS`, but `TOP` is written by hand here, and
// `parseArgs` passes any first token it does not recognise straight through to the server. So a
// future one-word command — `astera doctor`, say — compiles clean with no usage at all, and the
// only thing that would notice is the doc guard, and only once someone had added it to
// `docs/cli.md`. A new *verb* cannot slip through, because `NOUNS` is where verbs are declared; a
// new *noun-less command* can. If one is added, add it to `TOP`.
//
// The text is plain, not JSON, and no part of it needs a Host. `--help` is for a person, and a
// person asking what the commands are must get an answer with nothing running.
import { APP_VERBS, BROWSER_VERBS, NOUNS, camel, leadingGlobals, renamedTo, verbsOf } from './cliArgs'

/** `jobs-wait`, `host-start`, … — every noun/verb pair `NOUNS` declares. */
type NounCommand = {
  [N in keyof typeof NOUNS]: `${N}-${(typeof NOUNS)[N][number]}`
}[keyof typeof NOUNS]

/** The commands with no verb. They have no noun either, so `NOUNS` cannot name them.
 *
 *  **`agent-context` has a dash and is still one token.** `spelledCommand` below reads that off
 *  `NOUNS` rather than off this list — `agent` is not a noun, so nothing splits it. */
const TOP = ['version', 'status', 'help', 'agent-context', 'main-plan'] as const

export type PublicCommand =
  | NounCommand
  | (typeof TOP)[number]
  | `browser-${(typeof BROWSER_VERBS)[number]}`

export interface UsageFlag {
  /** As typed, without the leading dashes: `timeout-ms`. */
  readonly name: string
  /** The placeholder printed after the flag. Absent for a flag that is only on or off. */
  readonly value?: string
  readonly required?: true
  readonly about: string
}

export interface CommandUsage {
  /** One line. It sits in a column beside its command, so it stays short and starts lower case. */
  readonly summary: string
  /** Printed only by the per-command level, for the commands whose one line would mislead. */
  readonly detail?: string
  readonly flags?: readonly UsageFlag[]
}

const ID = (value: string, about: string): UsageFlag => ({ name: 'id', value, required: true, about })
/** `tasks list` and `questions list`: only some fields, and one page with the total (command.ts listReply). */
const LIST_PAGE_FLAGS: UsageFlag[] = [
  { name: 'fields', value: '<a,b,…>', about: 'only these fields of each row (an unknown one is 2 and lists them)' },
  { name: 'limit', value: '<n>', about: 'at most n rows; the reply then carries total, offset and limit' },
  { name: 'offset', value: '<n>', about: 'skip the first n rows (default 0); the reply then carries total' }
]

const TIMEOUT: UsageFlag = {
  name: 'timeout-ms',
  value: '<ms>',
  about: 'how long to wait (default 3600000, one hour)'
}

/** What a Job is made with, beside its objective and its folder: `jobs create`'s flags, and `jobs create-from-source`'s
 *  after its own. */
// W6-A intake (intake.ts): what the planner starts from, beside the objective. jobs-create-from-issue takes them too.
const INTAKE_FLAGS: readonly UsageFlag[] = [
  {
    name: 'mode',
    value: '<plan|audit|fixlist|prompts>',
    about: 'plan (default); audit: the planner audits --scope, writes inputs/audit.md, then plans the fixes; fixlist: the objective is a problem list, one or more Tasks per problem; prompts: Run as written (below)'
  },
  { name: 'scope', value: '<path[,path…]|all>', about: 'with --mode audit: what to audit: all (default) or paths inside the repository, separated by commas or new lines' },
  { name: 'focus', value: '<bugs|security|performance|tests|simplify,…>', about: 'with --mode audit: what to look for (default bugs, security holes and missing tests)' },
  { name: 'instructions', value: '<text>', about: "the owner's extra instructions; they win over the source when the two conflict" },
  {
    name: 'attach',
    value: '<path>',
    about: "a file copied into the plan's inputs folder for the planner to read first (repeatable; a regular file of at most 30 MB)"
  },
  // W8-C prompts mode
  {
    name: 'approve',
    value: '<auto|ask>',
    about:
      "with --mode prompts (Run as written: each attached .md file, or each `## ` section of one document, is one Task with its text unchanged, ordered by docs/dev/PLAN.md's wave table; with nothing attached, the prompt ids in --objective, such as \"W8-A, B then all of W9\" or \"next waves\", are found in the project's prompts folder): auto (default) starts the plan without an approval step; ask waits for it"
  }
]

const JOB_MAKING_FLAGS: readonly UsageFlag[] = [
  { name: 'concurrency', value: '<n>', about: 'how many workers this Job places at once (1-100; more reads as 100)' },
  { name: 'priority', value: '<n>', about: 'which Job gets a free slot first when the app-wide worker cap is reached (higher first, default 0)' },
  // T1 chat-first planning
  { name: 'planning', value: '<chat|auto>', about: "how the planner works: chat brainstorms with you in its terminal (it may start with no objective), auto decides alone and records its decisions (default chat; auto when hands-off or made by an agent session)" },
  // W6-D wave replanning
  { name: 'replan', value: '<waves|off>', about: 'whether a planned Job is replanned between waves and checked once more at the end (default waves)' },
  {
    name: 'coordinator-account',
    value: '<accountId>',
    about: 'the account a coordinator session runs on (one, from `accounts list`)'
  },
  {
    name: 'coordinator-provider',
    value: '<claude|codex>',
    about: "without --coordinator-account, that provider's default account coordinates"
  },
  {
    name: 'convergence',
    about: 'repair failing tasks instead of failing them'
  },
  // W6-H delivery
  { name: 'delivery', value: '<pr|push|merge|manual>', about: "how this Job's finished plan lands, ahead of its project's: one pull request, pushed to the delivery branch with no review by a person, merged into the delivery branch on this computer and not pushed (merge), or left for you to review and deliver (manual)" },
  { name: 'delivery-branch', value: '<branch>', about: "the plan's target branch, ahead of its project's: its worktree forks from it and its PR, push or merge lands on it" },
  { name: 'max-fix-attempts', value: '<n>', about: 'repairs per task; needs --convergence' },
  { name: 'max-review-rounds', value: '<n>', about: 'review rounds per task; needs --convergence' },
  {
    name: 'blocking-severity',
    value: '<high|medium>',
    about: 'which review findings block; needs --convergence'
  },
  { name: 'max-total-minutes', value: '<n>', about: 'time budget per task; needs --convergence' }
]

/** The job-source commands' flags (plugin Phase 4 J21). */
const SOURCE: UsageFlag = { name: 'source', value: '<sourceId>', required: true, about: 'the source (from `sources list`)' }
const ITEM: UsageFlag = { name: 'item', value: '<itemId>', required: true, about: 'the item (from `sources items`)' }
const SOURCE_PROJECT: UsageFlag = {
  name: 'project',
  value: '<projectId>',
  about: 'the project, for a source that needs one: GitHub issues are its repository\'s (from `projects list`)'
}

/**
 * Every public command, one entry each.
 *
 * Missing keys and unknown keys are both compile errors, so this object is exactly the public
 * surface. See the head of this file for what that does and does not guarantee.
 */
export const USAGE: Record<PublicCommand, CommandUsage> = {
  version: { summary: 'CLI, app and protocol versions' },
  status: { summary: 'is the orchestrator there, and what is running' },
  // `--skills-dir <path>` is real and is left out on purpose. It relocates the folder the guide is
  // read from, overriding ASTERA_SKILLS, and it exists for the app and for development rather than
  // for a person at a prompt, who gets the guide this build ships with. The guide itself
  // documents it, which is the right place, because the guide is where the non-public commands are
  // documented and this flag is one of them. docs/cli.md makes the same call, documenting the
  // ASTERA_SKILLS variable and not the flag, which is why the doc guard cannot see the difference.
  help: {
    summary: 'the orchestration guide, in full',
    detail:
      'The reference agents read. It is a long document, not usage text. Inside a session Astera starts it comes from the folder ASTERA_SKILLS names; elsewhere, from the guides this build ships with.'
  },
  'agent-context': {
    summary: 'every command this binary can route, as JSON',
    detail:
      'For a caller that is a program. It lists the session-only commands as well as the public ones, with their flags, plus the protocol version and the exit codes. Like --help it needs no Host and always exits 0.'
  },

  'host-start': {
    summary: 'start a Host if none is running (already running is success)',
    detail:
      'Refused with 9 while a Host of another protocol serves the profile. With --replace an older one is asked to leave first, and the sessions it holds end with it.',
    flags: [{ name: 'replace', about: 'ask a Host of an older protocol serving this profile to leave first; its sessions end' }]
  },
  'host-status': { summary: 'is a Host running, and on which profile' },
  'host-stop': {
    summary: 'ask the running Host to retire',
    detail: 'Refused while the Host still holds sessions or running runs. It says how many.'
  },
  'host-restart': {
    summary: 'restart the Host now: hold new starts, wait for a safe point, hand sessions over',
    detail:
      'Holds new starts, waits for the working Tasks to reach a safe point (10 minutes unless --wait says otherwise), hands every session over and starts the next Host from this install, which resumes them. Progress goes to stderr. A Host too old to restart is refused with 9; `host stop` is what it can do.',
    flags: [
      { name: 'wait', value: '<minutes>', about: 'wait this long for the safe point (default 10, at most 60)' },
      { name: 'now', about: 'hand over at once; the Tasks not at a safe point are cut short and resumed' }
    ]
  },
  'mcp-serve': {
    summary: 'serve Astera to an MCP client over stdio',
    detail:
      'For an MCP client to launch, not for a person to type: stdout carries the MCP protocol. It connects to the Host of this profile, starting one when none answers, and serves forty tools that create, plan, run, observe, answer, stop and resume Jobs, read and use sessions when Settings allows it, read pull requests, CI and issues on GitHub and, when Settings allows it, act on them, read the job sources and make a Job from an item, read the How It Works records of a project and regenerate one, and list the Runtimes this machine is paired with. What it may do is set by MCP access in Settings (CLI tab). See docs/mcp.md.'
  },
  'runtime-start': {
    summary: 'turn Remote Runtime on: other machines may pair with this one',
    detail:
      'Writes remote-runtime.json, makes this machine’s identity the first time, starts a Host if none runs, and waits until the Gateway listens. It listens on 127.0.0.1 until --listen names an address; use a private network, a VPN or Tailscale, never a port forwarded to the internet. 0 when listening, 1 when the Gateway failed (the code says why), 7 when it was not listening within 10 seconds. Refused with 5 inside an agent session (ASTERA_SESSION is set): opening this machine to the network is for a person.',
    flags: [
      { name: 'listen', value: '<addr>', about: 'the address to listen on (default 127.0.0.1)' },
      { name: 'port', value: '<n>', about: 'the TCP port (default 47831)' }
    ]
  },
  'runtime-stop': {
    summary: 'turn Remote Runtime off; the Host and its Jobs keep running',
    detail: 'Writes remote-runtime.json and stops the Gateway. Paired controllers stay paired; they cannot connect until it is on again.'
  },
  'runtime-status': { summary: 'whether Remote Runtime is on, the Gateway state, the fingerprint and the paired clients' },
  'runtime-serve': {
    summary: 'keep a Host running while Remote Runtime is on (for an OS service, in the foreground)',
    detail:
      'For a logon task, a LaunchAgent or a systemd unit, not for a person. It never turns Remote on or off: it runs a Host while `runtime start` left it on, starts none while it is off, watches a Host the app already started, restarts one that crashes, and starts none during an app update. SIGTERM or SIGINT stops its Host and it exits 0. `astera host stop` is followed by a new Host while Remote is on: run `astera runtime stop` first.'
  },
  'runtime-pair': {
    summary: 'a one-time pairing string for another machine (valid 10 minutes)',
    detail:
      'Prints astera-pair:v1:<address>:<port>:<code>:<fingerprint> and its parts. It carries a secret code: give it to the other machine directly and do not paste it anywhere else. Five wrong codes burn it. The pairing is read-only unless --full-control is given. Refused with 5 inside an agent session (ASTERA_SESSION is set).',
    flags: [
      { name: 'full-control', about: 'the controller may also change things: run Jobs, start sessions, type into them' },
      { name: 'read-only', about: 'the controller may read but not change anything (the default)' },
      { name: 'name', value: '<n>', about: 'what to call the controller in `runtime clients`' }
    ]
  },
  'runtime-clients': { summary: 'the controllers paired with this machine' },
  'runtime-revoke': {
    summary: 'unpair a controller and close its connections now',
    flags: [ID('<clientId>', 'the controller to unpair (from `runtime clients`)')]
  },
  'runtime-setup': {
    summary: 'make this machine a Runtime in one command: install what it needs, keep it running, pair',
    detail:
      'Each step says ok, skipped (already there) or failed with the reason, so a second run changes nothing. It checks git and the Claude CLI and installs what is missing (apt on Ubuntu and Debian, winget on Windows, the vendor installer for Claude) only with --yes; installs the astera command; writes and starts the keep-alive service (a systemd user unit with linger, a Task Scheduler logon task, a LaunchAgent); listens on --listen, else the Tailscale address, else the one private LAN address, never every interface; and prints one pairing string, read-only unless --full-control. Exits 1 when a step failed, 2 for an address it refuses. Refused with 5 inside an agent session (ASTERA_SESSION is set).',
    flags: [
      { name: 'listen', value: '<addr>', about: 'the address to listen on (never 0.0.0.0)' },
      { name: 'tailscale', about: 'listen on the Tailscale address, and fail when there is none' },
      { name: 'name', value: '<n>', about: 'what controllers call this machine (default its host name)' },
      { name: 'full-control', about: 'the pairing may also change things' },
      { name: 'yes', about: 'install what is missing without asking' },
      { name: 'codex', about: 'install the Codex CLI too' }
    ]
  },
  'runtimes-add': {
    summary: 'pair this machine with a Runtime, from the string `astera runtime pair` printed there',
    detail:
      'Checks the Runtime\'s key against the fingerprint before the code is sent, keeps the token in this profile and never prints it. The parts may be given one by one instead of --pair; the fingerprint is then required.',
    flags: [
      { name: 'pair', value: '<string>', about: 'the astera-pair:v1: string; - reads it from stdin, off the command line other users can see' },
      { name: 'address', value: '<host>', about: 'the address to reach the Runtime at, over the one in the string' },
      { name: 'port', value: '<n>', about: 'its port, without --pair (default 47831)' },
      { name: 'code', value: '<code>', about: 'the one-time code, without --pair' },
      { name: 'fingerprint', value: '<fp>', about: 'the key fingerprint, without --pair' },
      { name: 'name', value: '<n>', about: 'what to call the Runtime here (default its own name)' },
      { name: 'replace', about: 'take the place of a Runtime paired here under the same id with another key' }
    ]
  },
  'runtimes-list': { summary: 'the Runtimes this machine is paired with' },
  'runtimes-remove': {
    summary: 'forget a paired Runtime on this machine (it does not revoke the pairing there)',
    flags: [ID('<runtimeId|name>', 'the Runtime to forget (from `runtimes list`)')]
  },
  // T12b
  'machines-add': {
    summary: 'install Astera on a Linux or Windows machine over SSH and pair it, in one step',
    detail:
      'Uses the system ssh and scp with your own keys or agent (BatchMode): Astera never asks for or keeps a password. Finds out the OS, uploads the installer (Linux: --installer or the newest dist-installer/astera-*-amd64.deb; Windows: --installer is required) with the matching install-runtime script, runs it, pairs with the ASTERA_PAIR= string it prints and pings the machine. Each step prints one line; a failure names the step, the end of what the machine wrote (secrets removed) and the fix. Running it again on a paired machine upgrades it and pairs again only when the pairing no longer answers. On Linux the install asks sudo for your password in this terminal.',
    flags: [
      { name: 'target', value: '<user@host>', required: true, about: 'the machine, as ssh takes it (also the first word after add)' },
      { name: 'port', value: '<n>', about: 'its SSH port (default 22)' },
      { name: 'installer', value: '<path>', about: 'the Astera installer to put on it (.deb for Linux, Astera-Setup.exe for Windows)' },
      { name: 'name', value: '<n>', about: 'what to call the machine (default its host name)' },
      { name: 'listen', value: '<ip>', about: 'the address its Runtime listens on' },
      { name: 'tailscale', about: 'listen on its Tailscale address' },
      { name: 'full-control', about: 'the pairing may also change things (needed to add projects there)' },
      // T12c
      { name: 'only', value: '<github,git,accounts,projects>', about: 'bring only these over (default all)' },
      { name: 'skip', value: '<github,git,accounts,projects>', about: 'bring all but these' },
      { name: 'projects', value: '<all|id,...>', about: 'which projects (default all with an origin remote)' },
      { name: 'yes', about: 'move without asking once more' }
    ]
  },
  // T12c
  'machines-migrate': {
    summary: "bring this computer's setup to a paired machine over SSH: GitHub login, git identity, accounts, projects",
    detail:
      'Lists exactly what moves (the GitHub user, git name and email, each account, each project with its origin and the folder it lands in) and asks once unless --yes. GitHub: `gh auth token` here, `gh auth login --with-token` and `gh auth setup-git` there, gh installed when missing; no SSH key moves. Claude accounts get a long-lived token from `claude setup-token` (approved once in the browser per account): their logins rotate their refresh tokens, so a copy would log this computer out. Codex accounts are made there and signed in once in this terminal. Projects with an origin are cloned to ~/astera/projects/<name> (Windows %USERPROFILE%\\astera\\projects\\<name>), registered and given their settings; uncommitted work stays here. Secrets go only over the SSH channel\'s input. --dry-run lists the plan and reads no secret. `machines add` runs this after pairing. Refused inside an agent session (ASTERA_SESSION is set).',
    flags: [
      { name: 'machine', value: '<runtime id|name>', required: true, about: 'the paired machine (also the first word after migrate)' },
      { name: 'target', value: '<user@host>', about: 'its SSH address, when `machines add` did not record one' },
      { name: 'port', value: '<n>', about: 'its SSH port (default the recorded one, else 22)' },
      // T12c
      { name: 'only', value: '<github,git,accounts,projects>', about: 'bring only these over (default all)' },
      { name: 'skip', value: '<github,git,accounts,projects>', about: 'bring all but these' },
      { name: 'projects', value: '<all|id,...>', about: 'which projects (default all with an origin remote)' },
      { name: 'yes', about: 'move without asking once more' },
      { name: 'dry-run', about: 'list what would move, read no secret, change nothing' }
    ]
  },
  'plugins-install': {
    summary: 'install a plugin from a folder or from npm, after you approve what it asks for',
    detail:
      'Shows the plugin, its version and the permissions it asks for, and installs nothing until you approve: --yes grants what it asks for, --grant names exactly what to grant (--grant "" grants none). Exits 2 until you approve. Plugins run trusted code on this machine: a plugin can do anything you can, and its permissions limit only what it asks Astera for. The folder is copied into this profile; installing the same plugin again replaces it and asks again. From npm, your npm fetches the package, or on a computer without Node.js an npm Astera fetches once from registry.npmjs.org; no install script runs, and the version installed is the one shown. Refused with 5 inside an agent session (ASTERA_SESSION is set).',
    flags: [
      { name: 'path', value: '<folder>', about: 'the plugin folder, the one with its package.json' },
      { name: 'npm', value: '<package>', about: 'a plugin published on npm: its name, with @version, @tag or a ^ or ~ range if you like' },
      { name: 'yes', about: 'approve the permissions the plugin asks for' },
      { name: 'grant', value: '<list>', about: 'approve exactly these permissions, comma separated (empty grants none)' }
    ]
  },
  'plugins-list': { summary: 'the plugins installed in this profile, with their status, what they were granted and what they offer' },
  'plugins-get': { summary: 'one installed plugin', flags: [ID('<pluginId>', 'the plugin (from `plugins list`)')] },
  'plugins-enable': { summary: 'let an installed plugin run', flags: [ID('<pluginId>', 'the plugin (from `plugins list`)')] },
  'plugins-disable': { summary: 'stop a plugin from running, keeping it installed', flags: [ID('<pluginId>', 'the plugin (from `plugins list`)')] },
  'plugins-remove': { summary: 'uninstall a plugin and delete its copy in this profile', flags: [ID('<pluginId>', 'the plugin (from `plugins list`)')] },
  'plugins-logs': {
    summary: "the last lines of a plugin's log: what it printed, and when it started, stopped or crashed",
    flags: [ID('<pluginId>', 'the plugin (from `plugins list`)'), { name: 'lines', value: '<n>', about: 'how many lines, from 1 to 1000 (default 100)' }]
  },
  'plugins-settings': {
    summary: "a plugin's settings: each one's value, a secret one only as set or not",
    flags: [ID('<pluginId>', 'the plugin (from `plugins list`)')]
  },
  'plugins-configure': {
    summary: "set or unset a plugin's settings; a running plugin starts again with them",
    detail:
      'A secret setting is kept in the plugin\'s own store and never shown back. Give a secret with --stdin <key> so it stays off the command line and out of the shell history. A plugin waiting for a required setting starts once it is set.',
    flags: [
      ID('<pluginId>', 'the plugin (from `plugins list`)'),
      { name: 'set', value: '<key=value>', about: 'set a setting; repeat for more' },
      { name: 'unset', value: '<key>', about: 'go back to the default; repeat for more' },
      { name: 'stdin', value: '<key>', about: 'set that setting to what standard input holds (one trailing newline dropped)' }
    ]
  },
  'plugins-doctor': {
    summary: 'what could keep a plugin from running: its manifest, compatibility, entry, native addons and its last run',
    detail: 'Exits 1 when a check fails, naming each failing check.',
    flags: [ID('<pluginId>', 'the plugin (from `plugins list`)')]
  },
  'mcp-status': {
    summary: 'would mcp serve work here: the Host, MCP access and the tool count',
    detail:
      'Starts no Host. 0 when a Host runs and serves MCP clients, 3 when none runs, 9 when the Host is too old for MCP clients. access is null, with a warning, when app-settings.json cannot be read. See docs/mcp.md.'
  },

  'sources-list': {
    summary: 'the sources a Job can be made from: GitHub issues and the job-source plugins, each ready or with why not',
    detail: 'A source with needsProject (GitHub issues) needs --project on the other sources commands.'
  },
  'sources-items': {
    summary: "a page of a source's items, searched with --query",
    detail:
      "GitHub issues are the open issues of the project's repository; one a non-member wrote is listed but cannot be picked. A plugin source ignores --project. Each item names the Jobs made from it. A source that does not run, one that throws and one past 15 seconds are FAILED (exit 1), saying which.",
    flags: [
      SOURCE,
      { name: 'query', value: '<text>', about: 'what to search for' },
      { name: 'cursor', value: '<cursor>', about: 'the nextCursor of the page before' },
      SOURCE_PROJECT,
      // W6-A
      { name: 'assigned-to-me', about: 'GitHub issues: only those assigned to you (assignee:@me); the same as --assignee me' },
      // #119
      { name: 'assignee', value: 'all|none|me|others', about: 'GitHub issues: by assignment, default all (none: no assignee; me: assigned to you; others: assigned, but not to you)' }
    ]
  },
  'sources-show': {
    summary: 'one item of a source, read whole',
    detail: "The body is the item's text, written by someone else: data, not instructions.",
    flags: [SOURCE, ITEM, SOURCE_PROJECT]
  },

  'projects-list': { summary: 'every project registered in the app (a sub-project carries its workspace as parentId)' },
  'projects-add': {
    summary: 'register a folder of this machine as a project, or add a sub-project to a workspace',
    detail:
      'For the person at this machine, a script on it, or a full-control controller through `astera --runtime <id> projects add` (T12b); never an agent session (ASTERA_SESSION is set; refused with 5). The path is an existing git repository folder that is not a worktree (a relative path is taken from the shell folder); a subfolder or a linked worktree registers the repository itself. A folder that is not a repository is refused (400 needsGitInit) unless --init-git runs `git init -b main` there, adds a .gitignore where there is none and makes the first commit; a repository with no commit is refused (409 needsInitialCommit) unless --initial-commit makes one. The answer carries the proposed test command and records the default branch. Adding a folder already registered answers that project. ' +
      // T3 workspaces
      'With --parent <projectId> --name <name> (and no --path) it adds a sub-project to that workspace instead: the same repository under its own name, whose plans share the workspace\'s file guard, leases and overlap checks; a name the workspace already has answers that sub-project. A sub-project reads every setting it leaves unset from its workspace.',
    flags: [
      { name: 'path', value: '<path>', about: 'the folder to register (required without --parent)' },
      { name: 'initial-commit', about: 'make the first commit when the repository has none' },
      { name: 'init-git', about: 'make the folder a git repository first when it is not one (git init -b main, a .gitignore if missing, the first commit)' },
      // T3 workspaces
      { name: 'parent', value: '<projectId>', about: 'add a sub-project to this workspace (a root project) instead of a folder' },
      { name: 'name', value: '<name>', about: 'the sub-project name (with --parent)' },
      { name: 'focus', value: '<a,b>', about: 'folders the sub-project usually works in, comma-separated (with --parent)' },
      // T12b
      { name: 'clone', value: '<git url>', about: 'clone this repository first, with the machine\'s own git credentials, into --path or ~/astera-projects/<name>' }
    ]
  },
  // T3 workspaces (projects.ts `removeProject`)
  'projects-remove': {
    summary: 'unregister a project; its folder and plans are not touched',
    detail:
      'Refused (CONFLICT, exit 6) while the project has a plan that is running, paused or queued (a completed, delivered, stopped or archived plan does not hold it), and for a workspace that still has sub-projects: remove those first; removing one project never removes another. Refused from an agent session and an MCP client.',
    flags: [ID('<projectId>', 'the project to unregister')]
  },
  // W7-B
  'projects-create': {
    summary: 'create a new project: a folder with a git repository, optionally a GitHub repository',
    detail:
      'For the person at this machine, or a script on it: a remote controller cannot, nor an agent session (refused with 5). Makes <parent>/<name>, runs git init, makes the first commit and registers it as a project. With --github the repository is created on GitHub and pushed (needs the gh CLI signed in). --describe is the repository description.',
    flags: [
      { name: 'name', value: '<name>', required: true, about: 'the folder and project name' },
      { name: 'parent', value: '<path>', required: true, about: 'the folder to create it in (relative: from the shell folder)' },
      { name: 'describe', value: '<text>', about: 'a one-line description' },
      { name: 'github', value: '<private|public>', about: 'also create a GitHub repository' }
    ]
  },
  'projects-github-create': {
    summary: 'create a GitHub repository for a project that has none, and push it',
    detail:
      'For the person at this machine, or a script on it: a remote controller cannot, nor an agent session (refused with 5). Runs `gh repo create <folder name> --source . --push` in the project (needs the gh CLI signed in) and answers the repository URL. Refused (409) when the project already has an origin remote. Private unless --public.',
    flags: [
      { name: 'project', value: '<path>', required: true, about: 'the project folder (relative: from the shell folder)' },
      { name: 'private', about: 'a private repository (the default)' },
      { name: 'public', about: 'a public repository' }
    ]
  },
  'git-branch-create': {
    summary: "create a branch in a project's repository and publish it to origin",
    detail:
      'Refused when the name is not a valid branch name or the branch already exists (409). Starts from --from (default: the repository default branch), taken from origin when origin has it. With an origin remote it then pushes the branch with an upstream, never with force; a failed push still answers ok with pushed false and the reason in pushError, and the local branch stays. Refused from an agent session and an MCP client.',
    flags: [
      { name: 'cwd', value: '<path>', required: true, about: 'the project folder (a registered project)' },
      { name: 'name', value: '<branch>', required: true, about: 'the new branch' },
      { name: 'from', value: '<branch>', about: 'the branch to start from (default: the repository default branch)' }
    ]
  },
  'projects-get': {
    summary: 'one registered project',
    flags: [ID('<projectId>', 'the project to read')]
  },
  // W6-H delivery (delivery.ts)
  'projects-set': {
    summary: "set a project's delivery, auto-approve, hands-off, serial files, test command, concurrency, review rounds, replan, setup command, prompts folder, standing grants, coordinator model and account",
    detail:
      'pr (the default) opens one pull request per plan and never merges it. push merges a finished plan into the delivery branch (the default branch unless --delivery-branch) and pushes it, with no review by a person, after the reviews, the final check and the validation pass; it stops and escalates when the folder is not on that branch, has uncommitted changes, cannot fast-forward, conflicts, fails validation or is rejected, and never force-pushes. merge does the same merge and validation in the project folder on this computer and pushes nothing. manual waits for you to review the plan. No delivery waits on GitHub Actions: the validation is the local checks. A Job may override it (`jobs create --delivery`). Defaults: delivery pr, auto-approve off, concurrency 3, review rounds 5, replan waves. --auto-approve on starts a plan without waiting for approval; --hands-off on also lets its coordinator answer its own escalations and bypasses permissions for its sessions. --test-command is saved as a run configuration and validates every new Task that has no --validate (--test-config picks an existing one). A new Job copies the concurrency, replan and review rounds when it sets none. An empty value clears a setting back to its default. Refused from an agent session and an MCP client.',
    flags: [
      ID('<projectId>', 'the project to set'),
      { name: 'delivery', value: '<pr|push|merge|manual>', about: 'how its finished plans land' },
      { name: 'delivery-branch', value: '<branch>', about: 'the branch a push or merge lands on (default: the repository default branch)' },
      // W7-A, W7-B
      { name: 'auto-approve', value: '<on|off>', about: 'approve this project\'s plans as soon as their planner finishes, with no one asked (default off)' },
      // #117
      { name: 'approval', value: '<ask|start|hands-off>', about: "the plan approval in one word: ask (approve by hand, even where the app's default starts plans), start (start once the plan holds) or hands-off; sets --auto-approve and --hands-off together" },
      { name: 'hands-off', value: '<on|off>', about: "run this project's plans hands-off (default off): nothing waits on the owner: the plan starts by itself once it holds, its coordinator answers its own escalations, and its planner, coordinator and workers run with permissions bypassed" },
      // T7
      { name: 'serial-files', value: '<on|off>', about: "never run two Tasks on the same files at once, and keep a done Task's files leased until its plan delivers (default off: they run side by side in their own worktrees and the merge worker settles a conflict)" },
      { name: 'test-command', value: '<cmd>', about: 'the command that validates a Task (saved as a run configuration)' },
      { name: 'test-config', value: '<id>', about: 'an existing run configuration to validate with' },
      { name: 'concurrency', value: '<1-100>', about: 'workers at once for a new Job (default: 3)' },
      { name: 'review-rounds', value: '<n>', about: 'review rounds for a new Job (default: 5)' },
      { name: 'replan', value: '<waves|off>', about: 'replan between waves (default: waves)' },
      { name: 'account', value: '<id>', about: 'the account the project uses' },
      // W10-A
      { name: 'setup-command', value: '<cmd|off>', about: 'the command run in every new plan and Task worktree to install dependencies (default: detected from the lockfile: bun, pnpm, yarn or npm); off runs none; empty detects again' },
      { name: 'prompts-dir', value: '<path|none>', about: 'the folder (in the repository) whose <id>-*.md files Run as written finds by name; none clears it' },
      // T3 workspaces
      { name: 'auto-projects', value: '<on|off>', about: 'file each plan under a sub-project named after its first area, created when missing (off for a project added from now on)' },
      // T5
      { name: 'grants', value: '<kind,...|none>', about: "kinds of decision granted in advance (kebab-case, e.g. protected-paths,migrations): the plan's coordinator writes a covered grant itself instead of escalating it; none clears them" },
      { name: 'coordinator-model', value: '<id|none>', about: "the coordinator's model for this project's plans, over the plan-size rule (a strong model for more than 5 Tasks or any hard Task); none clears it" }
    ]
  },
  'projects-find': {
    summary: 'the registered project a folder belongs to',
    detail:
      'The registered project whose folder is that path or holds it. When projects nest, the one with the longest folder wins. A folder no project holds is 4.',
    flags: [{ name: 'path', value: '<path>', required: true, about: 'the project folder, or any path inside it' }]
  },

  'jobs-list': {
    summary: 'every Job, with the state of its latest run',
    detail:
      'Two filters, and they combine. --status keeps the Jobs whose state is that word: the word the first column of --human shows, in lower case, where completed is COMPLETE. Any other value is refused with 2. --project keeps the Jobs of the project a folder belongs to, found the way `projects find` finds it; a folder no project holds is 4.',
    flags: [
      {
        name: 'status',
        value: '<pending|paused|scheduled|waiting|running|completed|failed>',
        about: 'only Jobs in this state'
      },
      { name: 'project', value: '<path>', about: 'only the Jobs of the project at this folder (from `projects list`)' },
      // W1-C plan lifecycle
      { name: 'archived', about: 'include archived Jobs, which are left out otherwise' },
      // W8-D plan areas
      { name: 'area', value: '<word>', about: 'only the Jobs whose areas name it (`jobs set --areas`)' }
    ]
  },
  'jobs-get': {
    summary: 'one Job, with a run folded in',
    detail:
      "Takes either id. Given a Job it folds in that Job's latest run, given a run it folds in that one.",
    flags: [ID('<jobId|runId>', 'a Job, or one run of it')]
  },
  'jobs-run': {
    summary: 'start a run of this Job now',
    detail:
      'Returns the run it started, which is the id to pass to `runs wait`. Refused while a run of this Job is already going.',
    flags: [ID('<jobId>', 'the Job to run')]
  },
  'jobs-create': {
    summary: 'create a Job with no run yet',
    detail:
      'Returns the Job. Nothing runs until `jobs run`: add its tasks first with `tasks add --job`. Without --cwd the Job belongs to the directory this command was run from. With --coordinator-account a coordinator session starts on that account when the Job runs; without it the workers are placed for you. A Host that announces dispatch places them whether Astera is open or closed, and otherwise Astera does.',
    flags: [
      { name: 'objective', value: '<text>', required: true, about: 'what this Job is for (may be left out with --mode audit or --attach)' },
      { name: 'cwd', value: '<path>', about: 'the repository root this Job belongs to (default: here)' },
      ...JOB_MAKING_FLAGS,
      ...INTAKE_FLAGS,
      // W7-E
      { name: 'no-review', about: 'do not review this plan\'s Tasks (`jobs plan` turns a review of every Task on otherwise)' },
      // W8-C plan after plan
      { name: 'after', value: '<jobId>', about: 'queue it after that Job (needs --coordinator-account): its planner starts by itself once that Job is delivered' },
      // #117
      { name: 'hands-off', about: "run this plan hands-off, ahead of its project's setting: nothing waits on the owner: the plan starts by itself once it holds, its coordinator answers its own escalations, and its planner, coordinator and workers run with permissions bypassed. Refused from an agent session and an MCP client" },
      { name: 'effort', value: '<low|medium|high|xhigh|max>', about: 'reasoning effort for the plan\'s workers whose Task sets none (a Task\'s own --effort wins)' }
    ]
  },
  'jobs-create-from-source': {
    summary: "create a Job in a project from a source's item: the item quoted as its objective, and kept as its source",
    detail:
      "Returns the Job, with no run yet, as `jobs create` does; it takes that command's flags but --objective and --cwd. Astera writes the objective, the item's text quoted as data, and the Job works in the project's folder. Refused for an item that cannot be picked (PERMISSION_DENIED, exit 5: a GitHub issue a non-member wrote, or a closed one) and for a GitHub pull request's number (NOT_FOUND, exit 4). A source that does not run, one that throws and one past 15 seconds are FAILED (exit 1), saying which.",
    flags: [SOURCE, ITEM, { name: 'project', value: '<projectId>', required: true, about: 'the project the Job works in (from `projects list`)' }, ...JOB_MAKING_FLAGS]
  },
  // W1-C plan lifecycle (lifecycle.ts)
  'jobs-rename': {
    summary: 'name a Job',
    detail:
      'The name is one line, cut at 300 characters, and is what the app, `jobs list --human` and the notifications show. An empty --title drops it, and the Job is named by its objective again. The objective, which is what agents are given, does not change. Every Job is named at creation by the first words of its objective (about 6 words); its planner renames it once it knows the goal. Refused from an agent session other than the Job\'s own planner.',
    flags: [ID('<jobId>', 'the Job to name'), { name: 'title', value: '<text>', required: true, about: 'the new name' }]
  },
  // W7-D (#67)
  'jobs-set': {
    summary: "change a running or queued plan's workers at once, priority, review rounds, replan, auto-approve, hands-off, delivery or effort, or its queue, areas or planning mode",
    detail:
      'Until the Job finishes; a finished one is refused (CONFLICT, exit 6). A lower number only holds back new starts: running workers carry on. At most 10. Refused from an agent session and an MCP client. ' +
      // Change a running plan
      "--concurrency, --priority, --review-rounds, --replan, --auto-approve, --hands-off, --delivery and --effort change a running or queued plan in any mix, in one write; a bad value changes nothing. They take effect for work that has not started yet. --delivery is refused (CONFLICT, exit 6) once the plan's delivery has started; --hands-off is refused from an agent session. " +
      // W8-C plan after plan
      '--after queues a Job that has not started planning after another (none clears it): its planner starts by itself once that Job is delivered (pushed, its pull request opened and not a draft, or ended with nothing to do). If that Job gives up or is archived, the queued one waits and escalates once. A chain that would wait on itself is refused (exit 2); a Job already planning is refused (CONFLICT, exit 6). ' +
      // W8-D plan areas
      '--areas names where the plan works, 1 to 3 short words (none clears them); `jobs list --area` filters by them. It is set on its own, and the Job\'s own planner may set it too. ' +
      // T1 chat-first planning
      '--planning and --priority (an integer, as at `jobs create`) change those two after creation, alone or together; --planning applies to the next planner start. ' +
      // T7 objective coverage
      "--left-out lists the objective's numbered or bulleted items the plan leaves out on purpose, each with why, as JSON ('[{\"item\":2,\"reason\":\"already built: src/x.ts\"}]', [] clears it): approval refuses a plan with an item no Task covers (`tasks add --covers`) and none left out. It is set on its own, and the Job's own planner may set it too. " +
      // T3 workspaces
      "Setting --areas files the plan under the sub-project of its workspace named after its first area, created when missing (a workspace's projects set autoProjects off stops it). --project <projectId> moves a plan that has not started to another project of the same workspace, on its own.",
    flags: [
      ID('<jobId | runId>', 'the Job to change, or one of its runs'),
      { name: 'concurrency', value: '<n>', about: 'workers at once, 1–100' },
      // W8-C plan after plan
      { name: 'after', value: '<jobId|none>', about: 'the Job this one is queued after; none clears it' },
      // W8-D plan areas
      { name: 'areas', value: '<a,b,c|none>', about: "1–3 short words for where the plan works (auth, api, ui); alone; its planner may set it too" },
      // T7 objective coverage
      { name: 'left-out', value: '<json array>', about: 'objective items left out on purpose, each {"item":<n>,"reason":"<why>"}; alone; its planner may set it too' },
      // T1 chat-first planning
      { name: 'planning', value: '<chat|auto>', about: 'how its planner works: chat brainstorms with you, auto decides alone' },
      { name: 'priority', value: '<n>', about: 'which Job gets a free slot first when the worker cap is reached (higher first, default 0)' },
      { name: 'review-rounds', value: '<n>', about: 'review rounds before a Task escalates; applies to Tasks not yet reviewed' },
      { name: 'replan', value: '<waves|off>', about: 'replan between steps, from the next step' },
      { name: 'auto-approve', value: '<on|off>', about: 'start the plan once planned without waiting for approval' },
      { name: 'hands-off', value: '<on|off>', about: 'run without asking; from a person only' },
      { name: 'delivery', value: '<pr|push|merge|manual>', about: 'how the plan lands; refused once delivery has started' },
      { name: 'delivery-branch', value: '<branch>', about: "the plan's target branch, ahead of its project's; empty clears it; refused once delivery has started" },
      { name: 'effort', value: '<low|medium|high|xhigh|max|none>', about: "reasoning effort for the plan's workers whose Task sets none; none clears it" },
      // T3 workspaces
      { name: 'project', value: '<projectId>', about: 'file a plan not started yet under another project of its workspace; alone' }
    ]
  },
  // W8-D several plans in one repo (overlap.ts)
  'jobs-overlaps': {
    summary: "where a Job's Tasks meet another active or queued plan's of the same project",
    detail:
      'One entry per pair of Tasks that touch overlapping affected paths or link the same issue, each with a line such as "T3 · Auth rework · T6 (same files: src/api/routes.ts)". Refreshed whenever either plan\'s Tasks change. An overlap never blocks approval: the two run side by side and the merge worker settles a conflict when their branches meet (with serial files on for the project, the later one waits).',
    flags: [ID('<jobId>', 'the Job to check')]
  },
  // T3 the main plan (mainPlan.ts)
  'main-plan': {
    summary: "the main plan of a project: its plans in run order, their open Tasks, and how they meet",
    detail:
      'Every plan of a project is a sub-plan of its main plan. Each shows its state and areas; a plan that is running or queued also its Tasks not completed (id, title, status, paths). Links name a Task that waits on another plan\'s Task (`--deps`) or on files another plan holds. --json gives the plans and links in full. Read only. Without --project it is the project of the plan or worker session that calls it.',
    flags: [{ name: 'project', value: '<projectId>', about: 'the project (from `projects list`; default: the calling session\'s Job\'s project)' }]
  },
  'jobs-archive': {
    summary: 'archive a Job: hide it and start nothing new for it',
    detail:
      'An archived Job is left out of `jobs list` (unless --archived) and the app hides it unless "show archived" is on. No new run, coordinator or worker starts for it; its running workers and coordinator keep running. With --kill-sessions each running run is stopped as `runs stop` stops it first, with the same refusals, and the Job is archived only if all of them went through. `jobs unarchive` takes it back.',
    flags: [
      ID('<jobId>', 'the Job to archive'),
      { name: 'kill-sessions', about: "also close its running runs' workers and coordinators (as `runs stop`)" }
    ]
  },
  'jobs-unarchive': {
    summary: 'bring an archived Job back',
    detail: 'It can start work again. A run that `jobs archive --kill-sessions` stopped stays paused until `runs resume`.',
    flags: [ID('<jobId>', 'the Job to bring back')]
  },
  // W2-A planner stage (planner.ts)
  'jobs-plan': {
    summary: 'start a planner session for a Job that has not started',
    detail:
      "The planner is an agent session in the Job's folder, on the planner model, that reads the repository and writes the plan as the Job's Tasks (each with a prompt, acceptance criteria and affected paths). It cannot start work: every command that would is refused to it. Start the Job (`jobs run`, or \"Approve & execute\" in Astera) to approve the plan; that is refused while a Task lacks a prompt or a criterion, a dependency is not in the plan, or the dependencies form a cycle, and refused from inside an agent session. The plan is also written to plans/<jobId>/plan.md in the profile. Refused with 9 once the Job has started.",
    flags: [
      ID('<jobId>', 'the Job to plan'),
      { name: 'account', value: '<id>', about: "the account the planner runs on (default: the Job's coordinator account)" },
      // W6-C
      { name: 'concurrency', value: '<n>', about: 'how many workers this Job places at once (1-100; more reads as 100)' },
      // T1 chat-first planning
      { name: 'planning', value: '<chat|auto>', about: "how the planner works: chat brainstorms with you in its terminal, auto decides alone (default: the Job's own)" },
      // W6-H delivery
      { name: 'delivery', value: '<pr|push|merge|manual>', about: "how this Job's finished plan lands, ahead of its project's: one pull request, pushed to the delivery branch with no review by a person, merged into the delivery branch on this computer and not pushed (merge), or left for you to review and deliver (manual)" },
      // W6-D wave replanning
      { name: 'replan', value: '<waves|off>', about: 'replan the rest of the plan between waves and check it once more at the end (default waves)' },
      // W7-E: a planned Job's Tasks are reviewed by a fresh reviewer, up to 5 rounds, then escalated
      { name: 'no-review', about: "do not review this plan's Tasks (default: every Task is reviewed before it counts as done)" },
      // W7-A
      { name: 'auto-approve', value: '<on|off>', about: "approve this plan as soon as its planner finishes, ahead of its project's setting" },
      // #117
      { name: 'hands-off', value: '<on|off>', about: "run this plan hands-off, ahead of its project's setting: nothing waits on the owner: the plan starts by itself once it holds, its coordinator answers its own escalations, and its planner, coordinator and workers run with permissions bypassed. Refused from an agent session and an MCP client" }
    ]
  },
  // W7-A talk to the planner (exec/plannerFeedback.ts)
  'jobs-feedback': {
    summary: "send the owner's feedback on a plan to its planner",
    detail:
      'Before approval the text goes to the same planner session: typed in while it runs, its conversation resumed when it has ended, else a fresh planner is started with plan.md, existing.md and the history. While the plan runs it starts a replan at once that changes only Tasks not started, and holds new workers meanwhile. Refused from an agent session, except the Astera console and the plan\'s own chat (`jobs chat-ensure`), which send it for the owner.',
    flags: [
      { name: 'job', value: '<jobId>', required: true, about: 'the Job whose plan to change' },
      { name: 'text', value: '<text|->', required: true, about: 'what to change; - reads stdin' }
    ]
  },
  // T2 planner chat on a finished plan (exec/plannerFeedback.ts)
  'jobs-chat': {
    summary: 'open a planner chat on a finished plan: ask what was done, add follow-up Tasks',
    detail:
      'Starts a planner on the finished plan that answers your questions from its Tasks\' reports and changed files, changes no files, and adds follow-up Tasks only when you ask; they run like the plan\'s own. Answers its session id; while a replan of the plan runs, answers that planner instead. Refused from an agent session.',
    flags: [{ name: 'id', value: '<jobId>', required: true, about: 'the finished Job to talk about' }]
  },
  // T2 a plan's own chat (console/console.ts ensureChat)
  'jobs-chat-ensure': {
    summary: "a plan's chat: one chat session per plan, started when none is alive",
    detail:
      "The Host starts it as a chat session titled \"Plan chat: <plan>\" in the plan's folder, with a first prompt that has it answer progress from the astera CLI and pass changes to the planner with `jobs feedback`; it changes no files and starts nothing. Its id is kept on the Job, so the next call answers the same session at any phase of the plan. One that ended is started again; one that moved to another account at a usage limit is followed to its new session. Answers the session as `sessions list` shows it. An unknown Job is 4, an archived one 6, a worker session 5, and a caller that is not the Host 6.",
    flags: [{ name: 'id', value: '<jobId>', required: true, about: 'the plan whose chat to answer' }]
  },
  'jobs-reject': {
    summary: 'reject a plan waiting for approval',
    detail:
      'The plan is archived with the reason and its planner ends. `jobs unarchive` undoes it. Refused from an agent session.',
    flags: [
      { name: 'job', value: '<jobId>', required: true, about: 'the Job whose plan to reject' },
      { name: 'reason', value: '<text>', about: 'why, kept on the archived Job' }
    ]
  },
  'jobs-wait': {
    summary: "wait until this Job's latest run ends",
    detail:
      'Five endings, and the exit code says which: finished well (0), a question is open, the run is paused, or the run is still running and every open worker, and the coordinator when it is stopped, is waiting for a usage limit to reset (8, `details` says which), the run failed (10). If the deadline passes first, it exits 7.',
    flags: [ID('<jobId>', 'the Job whose latest run to wait for'), TIMEOUT]
  },

  'runs-list': {
    summary: 'every run, oldest first',
    detail:
      "--project keeps the runs of the project's Jobs, the project found the way `projects find` finds it; a folder no project holds is 4. It combines with --job.",
    flags: [
      { name: 'job', value: '<jobId>', about: 'only the runs of this Job' },
      { name: 'project', value: '<path>', about: 'only the runs of the project at this folder' }
    ]
  },
  'runs-get': { summary: 'one run', flags: [ID('<runId>', 'the run to read')] },
  'runs-wait': {
    summary: 'wait until this run ends',
    detail:
      'Five endings, and the exit code says which: finished well (0), a question is open, the run is paused, or the run is still running and every open worker, and the coordinator when it is stopped, is waiting for a usage limit to reset (8, `details` says which), the run failed (10). If the deadline passes first, it exits 7.',
    flags: [ID('<runId>', 'the run to wait for'), TIMEOUT]
  },
  'runs-follow': {
    summary: "print this run's events as they happen, until it ends",
    detail:
      "Every event of the run's timeline so far, then each new one as it lands: one line each with --human, like `[14:21:02] worker started: task_1`, and one envelope per line in JSON (NDJSON), each with `data.event`. It stops where `runs wait` stops, with the same last line and the same exit code: finished well (0), a question open, the run paused or waiting for a usage limit (8), the run failed (10), or the deadline passed (7). Ctrl+C ends this command only; the run goes on.",
    flags: [ID('<runId>', 'the run to follow'), TIMEOUT]
  },
  'runs-stop': {
    summary: "close this run's open workers and pause it",
    detail:
      'Reversible, which is why it is not called cancel. `runs resume` clears exactly this. Refused while a dispatch is held open by worker-retain.',
    flags: [ID('<runId>', 'the run to stop')]
  },
  'runs-resume': {
    summary: 'let a paused run go again',
    flags: [ID('<runId>', 'the run to resume')]
  },
  'runs-checks': {
    summary: "each task's validation and review, and what they came to",
    detail:
      'One row per task of the run: `validation` (the run configurations it must pass, the last round of checks, each with its status, exit code and output tail) and `review` (whether one was asked for, and the verdict of the last reviewer that gave one, with its findings). Each has a `status`: not-required, pending, running, passed or failed. `failureSummary` says in one line what failed, validation first. A plugin check (`plugin:<id>`) carries its `summary`, `diagnostics` (the first 20, none once it passed), `diagnosticsTotal` (how many it found, when more) and `externalUrl`; its status `error` means it could not be made, and the task waits on a question. It reads what the checks already recorded and runs nothing.',
    flags: [ID('<runId>', 'the run whose checks to read')]
  },
  // T8
  'runs-doctor': {
    summary: 'every run whose stored state disagrees with what is really going on, and --fix to repair it',
    detail:
      "Each finding has a `kind`: `stuck` (the run reads running but nothing can move: `needs-you` when every unfinished task waits on you, `stalled` when its failed tasks have no coordinator and nothing retries them), `stalled` (T36: the run's only way on is through a failed task that holds back not-started ones; its `detail` names the task), `stopped-reviewer` (a task left reviewing after its reviewer ended), `lost-worker` (a task dispatched whose worker ended unreported, with no coordinator), `dead-dispatch` (a dispatch open whose session has exited) and `stray-session` (a session alive after its run finished). The two session checks need the Host's session list; `checkedSessions` says whether they ran. --fix applies the repair each already has and lists it in `repairs`: a retry Gate on each stalled task, the owner's question (Retry, Accept as done, Cancel what waits on it) for a run stalled on a failed task, the restart Gate for a stopped reviewer, the lost-worker Gate, the dispatch closed as its session's exit would have, the stray session closed. A `needs-you` run is left for you to answer. With no scope it looks at every run; a coordinator may doctor its own run only.",
    flags: [
      { name: 'run', value: '<runId>', about: 'only this run' },
      { name: 'job', value: '<jobId>', about: "only this Job's runs" },
      { name: 'all', about: 'every run (the default)' },
      { name: 'fix', about: 'repair what it finds' }
    ]
  },

  'tasks-list': {
    summary: 'the tasks of a run',
    flags: [
      {
        name: 'run',
        value: '<runId|jobId>',
        about: "only the tasks of this run; a Job's id gives the Job's own tasks (the ones `tasks add --job` adds)"
      },
      { name: 'status', value: '<s>', about: 'only tasks in this status' },
      { name: 'ready', about: 'only tasks that are ready to be picked up' },
      { name: 'brief', about: 'cut each spec to 160 characters' },
      ...LIST_PAGE_FLAGS
    ]
  },
  // W3-C search and inbox
  'dispatches-list': {
    summary: 'the dispatches (worker attempts) of every run, or of one run',
    detail:
      'One row per attempt: its task, session, account, model, folder, when it started and how it ended. Read only. A run that is not there is not found (4).',
    flags: [{ name: 'run', value: '<runId>', about: 'only the dispatches of this run' }]
  },
  // **--job and --run are both listed as optional, and exactly one of them is required.** A flag in
  // this table is either required or not; there is no field for "one of these two". `browser js`
  // has the same shape with --script and --file, and as there the rule is carried by the prose.
  'tasks-add': {
    summary: 'add a task to a Job, or to one run of it',
    detail:
      'Exactly one of --job or --run. A task added to a Job is copied into every run `jobs run` starts from then on; a task added to a run belongs to that run only. An id of the other kind is not found (4), never quietly the other thing. Returns the task. A spec with quotes or several lines goes on stdin: `--spec -` with a heredoc (`<<\'EOF\'`), so the shell changes nothing in it. --affected-paths tells where tasks meet (overlaps); with serial files on for the project, the scheduler keeps two tasks on the same files from running at once.',
    flags: [
      { name: 'job', value: '<jobId>', about: 'the Job to add it to (exactly one of --job or --run)' },
      { name: 'run', value: '<runId>', about: 'the run to add it to (exactly one of --job or --run)' },
      {
        name: 'spec',
        value: '<text|->',
        required: true,
        about: 'the work, in full (a value of `-` reads it from stdin)'
      },
      {
        name: 'account',
        value: '<id,…>',
        // T1: omitted is auto, so Tasks do not all pin the caller's own account
        about: 'only when the person named accounts: the ones a worker may run on, in failover order (from `accounts list`); omitted, Astera starts it on the account with most room'
      },
      { name: 'title', value: '<text>', about: "a short name (default: the spec's first line)" },
      { name: 'prompt', value: '<text|->', about: "the worker's prompt (default: the spec)" },
      { name: 'criteria', value: '<json array>', about: 'acceptance criteria, e.g. \'["tests pass"]\'; a task added to a planned run needs them' },
      { name: 'deps', value: '<json array>', about: 'the task ids this one waits for' },
      // W7-D (#81): the planner's flag, so a task added here is kept off its files' other tasks (W6-C)
      { name: 'affected-paths', value: '<json array>', about: 'the files or folders it will change, e.g. \'["src/a.ts","src/b/"]\'' },
      { name: 'no-files', about: 'an ops, audit or docs Task (--kind) that changes no repository file: it names none, and a planned Job accepts that' },
      { name: 'parent', value: '<taskId>', about: 'the task this one was split out of' },
      {
        name: 'validate',
        value: '<configId,…>',
        about:
          'run configurations that must pass before it counts as done (from `run-configs list`), or `plugin:<id>` for a completion check plugin (from `plugins list`)'
      },
      { name: 'review', about: 'have the result reviewed before it counts as done' },
      // W7-E: opts one Task out of its Job's review default (Job.review)
      { name: 'no-review', about: "do not review this Task, though its Job reviews its Tasks" },
      // W5-B (#53): the model choice a planner's Task carries (Task.difficulty / Task.model, resolveWorkerModel)
      {
        name: 'difficulty',
        value: '<light|standard|hard>',
        about: "picks the worker's model from Settings → Orchestration models (light → haiku, standard → sonnet, hard → opus by default)"
      },
      { name: 'effort', value: '<low|medium|high|xhigh|max>', about: "the worker's reasoning effort, ahead of the difficulty's default" },
      { name: 'model', value: '<id>', about: 'the worker model itself, ahead of --difficulty (e.g. sonnet)' },
      // W6-A: a planned Job's Task needs one to be approved
      { name: 'basis', value: '<missing|partial|broken>', about: "what exists of the item, checked before planning (with --evidence); a planned Job's Task needs it" },
      { name: 'evidence', value: '<text>', about: 'with --basis: file:line, an issue or PR number, a Job id' },
      // T7 objective coverage
      { name: 'covers', value: '<n,…>', about: "the numbers of the Job objective's items this task covers (a planned Job's every item needs one, or `jobs set --left-out`)" },
      // T9
      { name: 'kind', value: '<bugfix|feature|refactor|ui|audit|docs|test|ops>', about: "the sort of work; picks the skills the worker is told to use (default: read from the title and spec)" },
      // T3
      { name: 'worktree', value: '<new|reuse>', about: "where its worker starts: new (default) a worktree of its own; reuse the worktree of its one dep, for a direct continuation on the same files" }
    ]
  },

  'tasks-restore': {
    summary: 'bring back tasks and dispatches a backup file holds and the live store lost (owner only)',
    detail:
      'Reads a backup of orchestration.json (the `.bak` files next to it) and re-inserts the tasks of the chosen Job or run that exist there and not now, with the dispatches that had ended. It never overwrites an id the store has and never touches another Job. A task that was in flight comes back `ready`. `--dry-run` lists what would come back and changes nothing. Refused from an agent session (permission denied).',
    flags: [
      { name: 'from', value: '<file>', required: true, about: 'the backup file to read' },
      { name: 'job', value: '<jobId>', about: 'restore the tasks of this Job (exactly one of --job or --run)' },
      { name: 'run', value: '<runId>', about: 'restore the tasks of this run (exactly one of --job or --run)' },
      { name: 'dry-run', about: 'list the tasks that would come back and change nothing' }
    ]
  },
  'tasks-dispatch': {
    summary: 'place one ready task now, the way the loop places one',
    detail:
      'The Host places it through the same path its loop uses: the account the task names, the run worktree, the placement, then worker-start, so the answer is the worker it started (dispatchId, sessionId). Refused with 6 when the task is not ready, the run is paused or not running, the run is at its concurrency limit, the run is driven by a coordinator (tell the coordinator instead, or stop the run first), or the Host does not drive Jobs right now. What would open a question in the loop (no usable account, a worktree that cannot be made) is a 6 with the reason instead, and nothing is opened. It is for a person or a script, so a worker session is refused with 5. With --request-id a retry is not placed twice.',
    flags: [ID('<taskId>', 'the task to place (from `tasks list --ready`)')]
  },

  'questions-list': {
    summary: 'questions workers have asked',
    flags: [
      { name: 'run', value: '<runId>', about: 'only the questions of this run (an unknown run is 4)' },
      { name: 'task', value: '<taskId>', about: 'only the questions of this task' },
      { name: 'status', value: '<open|resolved>', about: 'only questions in this state (any other value is 2)' },
      { name: 'brief', about: 'each question and resolution on one line, cut to 160 characters' },
      ...LIST_PAGE_FLAGS
    ]
  },
  'questions-get': {
    summary: 'one question',
    flags: [ID('<questionId>', 'the question to read')]
  },
  'questions-answer': {
    summary: 'answer an open question',
    flags: [
      ID('<questionId>', 'the question to answer'),
      {
        name: 'answer',
        value: '<text>',
        required: true,
        about: 'the answer (a value of `-` reads it from stdin)'
      }
    ]
  },

  'accounts-list': {
    summary: 'the agent accounts the app holds',
    detail:
      'The ids `jobs create --coordinator-account` and `tasks add --account` take. With Astera closed the Host reads them from the profile, so this works either way.',
    flags: [{ name: 'agent', value: '<claude|codex>', about: 'only this vendor' }]
  },
  'accounts-login': {
    summary: 'sign a new Claude account in from this terminal, with no app',
    detail:
      'Makes a fresh config folder, registers it in the profile as an Astera account and runs `claude auth login` for it in this terminal: open the link it prints on any device and paste the code back. An account that did not sign in is taken off again. Exits 1 then. Needs no Host and no app.',
    flags: [
      { name: 'new', required: true, about: 'sign a new account in' },
      { name: 'label', value: '<name>', about: 'what to call it (default Claude)' }
    ]
  },
  // T12c
  'accounts-import': {
    summary: 'make an account here with a login brought from another machine (the target side of `machines migrate`)',
    detail:
      'The account with this label and agent, made when missing (same colour), its login file written owner-only (0600) from standard input. Run by `machines migrate` over SSH; refused inside an agent session (ASTERA_SESSION is set).',
    flags: [
      { name: 'label', value: '<name>', required: true, about: 'its label' },
      { name: 'agent', value: '<claude|codex>', required: true, about: 'its vendor' },
      { name: 'color', value: '<colour>', about: 'its colour' },
      { name: 'login', value: '<->', about: "its CLI's login file, read from standard input" }
    ]
  },

  // Answered in the CLI process from the profile's files, with no Host and no app (cli/skills.ts).
  'run-configs-list': {
    summary: "the run configurations of a Job's project",
    detail:
      "The ids `tasks add --validate` takes: each with `id`, `name` and `type`, and nothing else about it. They are the Job's folder's configurations, the ones the app's Run menu shows there. With Astera closed the Host reads the profile's saved configurations and the folder's build files itself, so this works either way.",
    flags: [{ name: 'job', value: '<jobId>', required: true, about: 'the Job whose project to list (from `jobs list`)' }]
  },

  // Saved through the app when it is attached, else by the Host into the profile's run-configs.json (host/orchDeps.ts).
  'run-configs-add': {
    summary: "save one run configuration in a project's list",
    detail:
      "Adds the configuration, or replaces the one with the same name (it keeps that one's id and place). It is checked by the rules the app's Run Configurations dialog applies when it saves: a known type with its fields, a unique id that is not a detected one (`seed:`), a cwd inside the project, an http(s) previewUrl, and no cmd.exe special characters on Windows. A configuration that fails is refused with the reason and nothing is written; other projects' configurations are never touched. Leave `id` out to get a new one. The saved configuration comes back as `config`, with `replaced` true when it took a name's place.",
    flags: [
      { name: 'project', value: '<path>', required: true, about: "the project's folder, as an absolute path" },
      { name: 'config', value: '<json|->', required: true, about: 'one configuration as a JSON object (`{"name":"Test","type":"shell","command":"npm test"}`), or - to read it from standard input' }
    ]
  },

  'skills-list': {
    summary: "which of Astera's agent skills each account has, and whether they are current",
    detail:
      'Per account, each skill with `enabled` (whether its setting in the app turns it on) and `installed`: current, stale (an older copy of ours that install would rewrite), missing, or not-ours (a file Astera did not write, which install leaves alone). It reads the profile and needs no Host and no app.',
    flags: [{ name: 'account', value: '<accountId>', about: 'only this account (from `accounts list`)' }]
  },
  'skills-install': {
    summary: 'install the skills the current settings enable, in every account',
    detail:
      'Writes what the settings in the app enable and nothing else: a skill whose setting is off is listed under notEnabled with the setting that turns it on. Each skill comes back written, unchanged, skipped-not-ours or failed, and any failed makes it exit 1. It removes nothing. Sessions already open do not pick up a new skill; open a new session. Run it after adding an account, which gets no skills until the app restarts. It needs no Host and no app.',
    flags: [{ name: 'account', value: '<accountId>', about: 'only this account (from `accounts list`)' }]
  },

  'higgsfield-list': { summary: 'List the Higgsfield accounts Astera keeps, with credits and the current one' },
  'higgsfield-use': {
    summary: 'Make one Higgsfield account current for every session (only after the user picked it)',
    flags: [{ name: 'account', value: '<id|label|email>', required: true, about: 'the account to switch to' }]
  },

  // Answered by the Host out of its own registries, so the app may be closed; it needs a Host.
  'sessions-list': {
    summary: 'the agent sessions the Host holds, running and ended',
    detail:
      'Each with its id, which is the id `sessions read` and `sessions send` take and the one `ASTERA_SESSION` holds inside that session. `kind` is terminal (an agent CLI in a terminal) or chat. `state` is working, waiting or unknown, from the hook events a Claude terminal session writes; Codex and chat sessions are always unknown, and so is a session typed into since its last event. Plain shell tabs and run configurations are not sessions and are not listed. Answered by the Host, so it works with Astera closed. --status alive or ended reads `alive`, and working, waiting or unknown reads `state`. --provider is the provider of the account the session runs on, as `accounts list` prints it; a session whose account is gone matches neither. Any other value is refused with 2. --project keeps the sessions whose folder is inside the project (found the way `projects find` finds it), and the workers and coordinators of its runs wherever their worktree is; a folder no project holds is 4.',
    flags: [
      { name: 'status', value: '<alive|ended|working|waiting|idle|unknown>', about: 'only sessions in this state' },
      { name: 'provider', value: '<claude|codex>', about: "only sessions on this vendor's accounts" },
      {
        name: 'project',
        value: '<path>',
        about: "only the sessions in the project's folder, and the workers and coordinators of its runs"
      }
    ]
  },
  'sessions-read': {
    summary: "what a terminal session's tab shows, or a chat session's recent turns",
    detail:
      "`kind` says which shape came back. A terminal session: the Host replays its recent output into a terminal at the tab's size. `screen` is the visible rows, top first, with the empty rows below the last painted one left off; `scrollback` is up to --lines rows (at most 10000) from just above it, oldest first; `cols` and `rows` are the size; `screenWrapped` and `scrollbackWrapped` mark, row for row, each row that continues the one above it (a line wider than the tab). Text only, trailing spaces trimmed, no colours. The Host keeps about 256,000 characters of each running session and drops them when it ends. A chat session: `turns` is up to --turns turns (at most 200), oldest first, each with `role`, `text` and `tools` (one line per tool call), read from the transcript the agent writes, so it works with Astera closed and survives the session ending. `pending` names the card the session is waiting on (an approval or a question), answered by whichever process is that session's writer: the Host's own adapter, Astera closed included, or Astera when it holds the session instead. It is left out when neither can say. --lines is for terminal sessions and --turns for chat sessions; the other one is refused with 2.",
    flags: [
      ID('<sessionId>', 'the session to read (from `sessions list`)'),
      { name: 'lines', value: '<n>', about: 'terminal: how many rows of scrollback above the screen (default 200)' },
      { name: 'turns', value: '<n>', about: 'chat: how many of the most recent turns (default 20)' }
    ]
  },
  'sessions-send': {
    summary: 'type into a terminal session and press Enter, or send a chat session one turn',
    detail:
      'A terminal session: writes the text, then Enter 150ms later, the way the app delivers a scheduled message. It types into whatever the session shows, a permission prompt included, so read it first; from inside an agent session, a send into a terminal session at a permission prompt or a question is refused with 6 before anything is typed. A chat session: the text is one turn, delivered by whichever process is that session\'s writer. With Astera open and holding the session, the app delivers it, and a session waiting on a card (an approval or a question) is refused with 6 naming the card: answer it with `chats answer`, or in Astera. Just after Astera starts, a session it has not taken back yet is a 6 as well. Otherwise, once the Host holds an adapter for the session, the Host delivers it itself, Astera closed included, refusing the same way for an open card; for a Codex session it sends only the text, with no model, effort or plan mode, so the settings the thread has now apply. A session the Host holds no adapter for still takes a blind write that queues behind any card. A send refused for a card, for a session not taken back yet or for a Codex session with no thread sent nothing, so the same --request-id can be used again. --no-enter is for terminal sessions only. One send at a time per session either way. `--text -` drops one trailing newline. A session that has ended is refused with 6. Any process running as you can do this to any session, agent sessions included. With --request-id a retry is not sent twice. --wait then waits until the turn ends: for a terminal session when its hook events leave it waiting with no prompt, for a chat session when its adapter goes back to idle. It exits 0 when the turn ended, 8 when a permission prompt or a question opened first (`details.promptId` names a chat prompt for `chats answer`), 7 when the deadline passed, and 1 when the session ended first; `data.turn` says which. A Codex terminal session writes no hook events, a chat session nothing holds cannot be read, and a terminal session busy in a turn would end the wait on that turn, so all three are refused with 6 before anything is typed. --wait with --no-enter is 2.',
    flags: [
      ID('<sessionId>', 'the session to type into (from `sessions list`)'),
      { name: 'text', value: '<text|->', required: true, about: 'what to type (a value of `-` reads it from stdin)' },
      { name: 'no-enter', about: 'terminal: type the text and do not press Enter' },
      { name: 'wait', about: 'after the send, wait until the turn it starts ends' },
      { name: 'timeout-ms', value: '<ms>', about: 'with --wait: how long to wait (default 3600000, one hour)' }
    ]
  },
  'sessions-create': {
    summary: 'start a terminal or chat session in a folder, on the account with most room or the one you name',
    detail:
      "The Host starts it, so Astera may be open or closed: a terminal session the way it starts a worker (the agent CLI in a terminal, with Astera's hooks, the folder trusted, and its permission prompts on or off as Astera's setting says), a chat session the way it restarts one after a roll. With Astera open, it takes the session back and shows it as a tab. Answers the session as `sessions list` shows it; its id is what `sessions read` and `sessions send` take. Without --account it starts on the --provider account (claude by default) with the most room and rolls over every account of that provider at a usage limit; with \"Pick accounts automatically\" on, a named account is a preference: one that is full or logged out is not started on, and the session takes the first of its chain with room, else the account with most room. Nothing with room is 2. --prompt is the first thing it is asked. --roll-accounts is the chain it rolls onto at a usage limit, --account first unless you place it; every account must be one vendor's, and it needs --account. --unattended is for chat sessions: hold (the default) leaves a permission prompt open for someone to answer, deny-after-60s denies it after a minute when nobody has. A folder that does not exist is 2, an unknown account 4, and a Host started without the agent CLI paths is 6. A worker session (one with an open Dispatch) is refused with 5. With --request-id a retry does not start a second session.",
    flags: [
      { name: 'account', value: '<accountId>', about: 'the account it runs on (from `accounts list`); default: the one with most room' },
      { name: 'provider', value: '<claude|codex>', about: 'without --account: whose accounts to pick from (default claude)' },
      { name: 'cwd', value: '<path>', required: true, about: 'the folder it starts in (a relative path is from here)' },
      { name: 'kind', value: '<terminal|chat>', about: 'terminal (default) or chat' },
      { name: 'title', value: '<text>', about: "the tab's title (default: the folder's name)" },
      { name: 'prompt', value: '<text|->', about: 'the first prompt (a value of `-` reads it from stdin)' },
      { name: 'roll-accounts', value: '<id,…>', about: 'the accounts to roll onto at a usage limit, in order' },
      { name: 'unattended', value: '<hold|deny-after-60s>', about: 'chat: a permission prompt nobody answers' }
    ]
  },
  // T10
  'console-ensure': {
    summary: 'the Astera console: one chat session for every project, started when none is alive',
    detail:
      "The Host starts it as a chat session titled \"Astera console\" in Astera's profile folder, with a first prompt that teaches it the astera CLI, and keeps its id in that folder, so a Host restart answers the same session. One that ended is started again; one that moved to another account at a usage limit is followed to its new session. Answers the session as `sessions list` shows it. A worker session is refused with 5, and a caller that is not the Host 6.",
    flags: []
  },
  // T8
  'sessions-close': {
    summary: 'end a session, as closing its tab does, with Astera open or closed',
    detail:
      "The Host ends it the way it ends a finished run's sessions, and its tab says Astera closed it. A coordinator may close only its own run's sessions (3). A worker session with an open dispatch is refused (5): stop it with `worker-stop`. An unknown session is 4; one that already ended answers `alreadyEnded`.",
    flags: [
      ID('<sessionId>', 'the session to end (from `sessions list`)'),
      { name: 'reason', value: '<text>', about: 'why, written to the log (default: closed with astera sessions close)' }
    ]
  },
  // T5
  'worktrees-list': {
    summary: 'the worktrees Astera made: path, branch, run, state and age',
    detail:
      "`state` is `live` (a session runs there), `dirty` (uncommitted changes or untracked files git does not ignore), `unpushed` (commits that exist nowhere else), `orphan` (no plan owns it, or git forgot the folder), `merged` (its plan's work is safe elsewhere: it can go) or `active` (its plan still works on it). `stale` marks what `worktrees remove --stale` removes: the `merged` ones and leftover folders git forgot. A coordinator sees its own run's worktrees only. Answered by the Host. Read only.",
    flags: [
      { name: 'project', value: '<id|path>', about: "only this project's worktrees" },
      { name: 'stale', about: 'only the ones `worktrees remove --stale` would remove' }
    ]
  },
  'worktrees-remove': {
    summary: 'remove worktrees (and their merged branches) that are safe to remove',
    detail:
      "Exactly one of --path, --run and --stale. Without --force a worktree that is dirty or has unpushed commits is kept, with the reason; one with a live session is never removed. A branch is deleted only when its work is already in its base, here and on origin when Astera pushed it. --dry-run removes nothing and lists what would go in `wouldRemove`. A coordinator may remove its own run's worktrees only (3). Answered by the Host.",
    flags: [
      { name: 'path', value: '<path>', about: 'this worktree' },
      { name: 'run', value: '<runId>', about: "every worktree of this run (delivered or not: what is unsafe is kept)" },
      { name: 'stale', about: 'every stale worktree (see `worktrees list --stale`)' },
      { name: 'project', value: '<id|path>', about: 'with --stale: only this project' },
      { name: 'force', about: 'also remove dirty and unpushed worktrees (a live one still stays)' },
      { name: 'dry-run', about: 'remove nothing; list what would go' }
    ]
  },
  'chats-pending': {
    summary: 'the permission prompts and questions chat sessions are waiting on',
    detail:
      'Each with its session, its prompt id (the id `chats answer` takes), its kind (approval or question), the tool it asks about and a one-line summary. Answered by the Host: it lists the sessions it writes to itself and asks Astera, when it is open, for the rest. `complete` is false when Astera is open but could not be asked, so the list may be short. Works with Astera closed.',
    flags: [{ name: 'session', value: '<sessionId>', about: 'only this session (from `sessions list`)' }]
  },
  'chats-answer': {
    summary: 'allow or deny one permission prompt a chat session is waiting on',
    detail:
      'The session that holds the prompt answers it, whether Astera or the Host writes to it, and the turn goes on. Exactly one of --allow and --deny. A question is not a permission prompt and is refused with 6: answer it in Astera. A prompt that is no longer open is refused with 6 and nothing is answered. A prompt id is per session, so an id open in two sessions needs --session (2 otherwise). It is for a person: run from inside an agent session (where ASTERA_SESSION is set) it is refused with 5. With --request-id a retry is not answered twice.',
    flags: [
      ID('<promptId>', 'the prompt to answer (from `chats pending`)'),
      { name: 'allow', about: 'let the tool run' },
      { name: 'deny', about: 'refuse it; the turn goes on without it' },
      { name: 'session', value: '<sessionId>', about: 'the session that holds the prompt' }
    ]
  },

  'requests-show': {
    summary: 'did a call of mine land, and what did it answer',
    detail:
      'For a command whose answer was lost, which is exit 3 or exit 7 with the Host still there. Three states, and all three exit 0, because not finding a receipt is an answer rather than a failure: `completed` carries in `response` the envelope the command answered with, `pending` means a Host is running it right now, and `absent` means this Host holds no receipt for that id under your session, which is not proof that nothing happened. `interpretation` says which, in a sentence, and `hostStartedAt` says when this Host started: receipts live in its memory, so one that started after you sent the request never saw it. With no Host at all it is exit 3, because then there is no receipt to have and the question is answered by reading the state.',
    flags: [ID('<requestId>', 'the id the call was sent with (--request-id)')]
  },

  'browser-js': {
    summary: "run one script in this session's agent browser",
    detail:
      'One script: --script, --file, or the whole of stdin when neither is given. Giving both is refused. It needs a session the app started, with the agent browser switched on.',
    flags: [
      { name: 'script', value: '<text>', about: 'the script to run (a value of `-` reads stdin)' },
      { name: 'file', value: '<path>', about: 'a file to read the script from' }
    ]
  },
  'browser-help': { summary: 'the agent browser guide' }
}

/**
 * `jobs-wait` as a person types it: `jobs wait`.
 *
 * **The dash is a separator only when it separates a noun from one of its verbs.** Plenty of
 * command names contain a dash and are still one token: `agent-context` here, and every
 * session-only command — `worker-start`, `task-create`, `run-configs`, `gate-resolve`. Splitting
 * those printed a command that does not exist, and `parseArgs` would then read the first half as
 * the whole command. So the test is `NOUNS` itself, not a hand-kept list of exceptions: `worker` is
 * not a noun, `runs` is.
 *
 * **Each dash in turn, until a noun's verb follows it**, because a noun can hold a dash of its own
 * (`run-configs-list` is `run-configs list`) and so can a verb (`jobs-create-from-source` is
 * `jobs create-from-source`). The first dash where the rest is one of that noun's verbs is the split.
 *
 * Exported because cliOutput.ts builds `astera jobs get --help` as a recovery step and
 * cliAgentContext.ts prints one line per command, and three spellings of one rule would drift.
 */
export const spelledCommand = (cmd: string): string => {
  // Each dash in turn, since a noun (`run-configs`) and a verb (`create-from-source`) may hold one
  for (let dash = cmd.indexOf('-'); dash >= 0; dash = cmd.indexOf('-', dash + 1)) {
    const noun = cmd.slice(0, dash)
    const verb = cmd.slice(dash + 1)
    const verbs: readonly string[] | undefined = noun === 'browser' ? BROWSER_VERBS : noun === 'app' ? APP_VERBS : verbsOf(noun)
    if (verbs?.includes(verb) === true) return `${noun} ${verb}`
  }
  return cmd
}

/** `--id <jobId>`, or `[--timeout-ms <ms>]` when it is optional. */
const spelledFlag = (f: UsageFlag): string => {
  const body = f.value === undefined ? `--${f.name}` : `--${f.name} ${f.value}`
  return f.required === true ? body : `[${body}]`
}

/** One command with its flags, ready to copy: `astera jobs wait --id <jobId> [--timeout-ms <ms>]`.
 *
 *  Exported because cliAgentContext.ts prints the same line for the session-only commands, whose
 *  usage is not in `USAGE` — written twice the two spellings would drift. */
export const invocationLine = (cmd: string, flags: readonly UsageFlag[] = []): string =>
  [`astera ${spelledCommand(cmd)}`, ...flags.map(spelledFlag)].join(' ')

/** The first line of the per-command level. */
const invocation = (cmd: PublicCommand): string => invocationLine(cmd, USAGE[cmd].flags ?? [])

type Row = readonly [string, string]

/** Two columns. `width` is passed in when several blocks have to line up as one table, as the root
 *  level's groups do — laid out separately they would each find their own column and the summaries
 *  would step in and out down the page. */
function columns(rows: readonly Row[], width = Math.max(...rows.map(([left]) => left.length))): string[] {
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`)
}

const TAIL = 'The full reference, including the exit codes, is docs/cli.md.'

/** Folds a `detail` paragraph into indented lines. Narrow enough that an 80-column terminal does
 *  not wrap it again at a different place. */
function wrapped(text: string): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > 76) {
      lines.push(line)
      line = word
    } else line = line === '' ? word : `${line} ${word}`
  }
  if (line !== '') lines.push(line)
  return lines.map((l) => `  ${l}`)
}

/** Level 1: every public command, one line each. */
export function rootUsage(): string {
  const row = (cmd: PublicCommand): Row => [spelledCommand(cmd), USAGE[cmd].summary]
  const blocks: Row[][] = [
    TOP.map(row),
    ...Object.entries(NOUNS as Record<string, readonly string[]>).map(([noun, verbs]) =>
      verbs.map((verb) => row(`${noun}-${verb}` as PublicCommand))
    ),
    BROWSER_VERBS.map((verb) => row(`browser-${verb}` as PublicCommand))
  ]
  const width = Math.max(...blocks.flat().map(([left]) => left.length))
  const groups = blocks.map((rows) => columns(rows, width))
  return [
    "astera: read and drive Astera's Jobs, runs, tasks and questions from a shell.",
    '',
    'usage:',
    '  astera <command> [flags]',
    '',
    'commands:',
    ...groups.flatMap((lines, i) => (i === 0 ? lines : ['', ...lines])),
    '',
    'output is JSON. --human prints aligned columns for reading, --quiet prints ids only.',
    'while a wait is on, a line every 15s goes to stderr, never stdout. --no-keepalive stops them.',
    'any other command whose Host has not answered in 3s says so on stderr the same way.',
    '--verbose says on stderr which Host was reached, its handshake, and how long each call took.',
    'astera --project <path> <command> filters jobs list, runs list and sessions list to that project.',
    // **The one flag here that changes what happens rather than how it is printed.** It was missing,
    // and `requests show`'s own usage text refers to it by name — so a person sent to that command
    // had no way to learn it from `--help`, which is the level that answers with nothing running.
    '--request-id <id> on any command says a retry is the same request: it is not done twice.',
    '',
    "astera <noun> --help lists that noun's verbs.",
    'astera <noun> <verb> --help describes one command and its flags.',
    TAIL
  ].join('\n')
}

/** Level 2: one noun's verbs, one line each. */
export function nounUsage(noun: string, verbs: readonly string[]): string {
  return [
    `astera ${noun} <verb> [flags]`,
    '',
    ...columns(
      verbs.map((verb) => {
        const cmd = `${noun}-${verb}` as PublicCommand
        return [verb, USAGE[cmd].summary] as const
      })
    ),
    '',
    `astera ${noun} <verb> --help describes one command and its flags.`
  ].join('\n')
}

/** Level 3: one command, what it does, and its flags. */
export function commandUsage(cmd: PublicCommand): string {
  return usageText(invocation(cmd), USAGE[cmd])
}

/** Level 3 for a command `USAGE` does not carry, one a coordinator or worker session uses
 *  (`worker-release`, say): the entry `agent-context` prints for it, laid out the same way. */
export function sessionCommandUsage(cmd: string, entry: CommandUsage): string {
  return usageText(invocationLine(cmd, entry.flags ?? []), entry, [
    '',
    '  A command a coordinator or worker session uses. `astera help` documents it.'
  ])
}

function usageText(first: string, entry: CommandUsage, note: readonly string[] = []): string {
  const flags = entry.flags ?? []
  return [
    first,
    '',
    `  ${entry.summary}`,
    ...note,
    ...(entry.detail === undefined ? [] : ['', ...wrapped(entry.detail)]),
    ...(flags.length === 0
      ? []
      : [
          '',
          'flags:',
          ...columns(
            flags.map(
              (f) =>
                [
                  f.value === undefined ? `--${f.name}` : `--${f.name} ${f.value}`,
                  `${f.required === true ? 'required  ' : '          '}${f.about}`
                ] as const
            )
          )
        ]),
    '',
    TAIL
  ].join('\n')
}

/**
 * The two tokens that mean "print usage instead of running this". Either of them, anywhere on the
 * line, wins over the command.
 *
 * `-h` is the only single-dash token this program understands; `parseArgs` rejects every other one.
 *
 * **The two are not equally safe, and the difference is on purpose.** `--help` can never be
 * mistaken for a flag's value: `parseArgs` only consumes a following token as a value when it does
 * not start with `--`. `-h` can be, because that test excludes nothing else — so
 * `astera questions answer --id q --answer -h` prints usage instead of recording the answer `-h`.
 *
 * That case is given up knowingly rather than guarded. Guarding it means deciding here which tokens
 * `parseArgs` would have eaten, which is a second copy of its value rule sitting in another file,
 * and it would also stop `astera tasks list --ready -h` from working, which someone would type. The
 * cost of being wrong is one flag whose literal value is the two characters `-h`, no documented flag
 * takes such a value, and the failure is loud: usage text arrives where an envelope was expected.
 * `--help` is unambiguous everywhere and is what the documentation tells people to use.
 */
const HELP_TOKENS = new Set(['--help', '-h'])

/**
 * Usage for whatever the person asked about, or `null` when they did not ask.
 *
 * **It answers before `parseArgs`** (run.ts), because all three levels used to fail there: a leading
 * flag was `expected a command, got flag`, a noun with a flag where its verb goes was `jobs needs
 * one of: …`, and `jobs list --help` was worst of all — `--help` parsed as an ordinary flag, went to
 * the server, was ignored, and the command ran. Asking for help silently did the thing.
 */
export function usageFor(
  argv: string[],
  /** The usage of a session-only command, by name (cliAgentContext's `sessionUsage`). Passed in rather
   *  than imported, because cliAgentContext.ts imports this file. */
  sessionUsage: (name: string) => CommandUsage | undefined = () => undefined
): { text: string } | { error: string } | null {
  if (!argv.some((t) => HELP_TOKENS.has(t))) return null
  // The mode flags a line may start with (`astera --verbose jobs list --help`) are skipped, so the
  // command after them is the one described. A line that starts with any other flag gets the root.
  const lead = leadingGlobals(argv.filter((t) => !HELP_TOKENS.has(t)))
  const from = 'error' in lead ? 0 : lead.start
  const words: string[] = []
  for (const tok of argv.filter((t) => !HELP_TOKENS.has(t)).slice(from)) {
    if (tok.startsWith('-')) break
    words.push(tok)
  }
  const [first, second, ...rest] = words
  if (rest.length > 0) return { error: `unexpected argument: ${rest[0]}` }
  if (first === undefined) return { text: rootUsage() }
  // **The rename hint is checked here too, and for the same reason it exists at all.** It is aimed
  // at an agent carrying the old vocabulary, and an agent that reads `astera help` every time it
  // starts is exactly the caller likely to ask for help on the name it remembers. Answering
  // `no usage for run-list` would drop the hint on the one audience it was written for.
  const renamed = renamedTo(first)
  if (renamed !== undefined)
    return { error: `${first} was renamed to \`${renamed}\` (try: astera ${renamed} --help)` }
  const verbs = first === 'browser' ? BROWSER_VERBS : verbsOf(first)
  if (verbs !== undefined) {
    if (second === undefined) return { text: nounUsage(first, verbs) }
    if (!verbs.includes(second))
      return { error: `unknown ${first} subcommand: ${second} (expected ${verbs.join(', ')})` }
    return { text: commandUsage(`${first}-${second}` as PublicCommand) }
  }
  if (second !== undefined) return { error: `${first} takes no subcommand` }
  // Not a public command. The coordinator's own commands land here, and they have usage too: the
  // entry `agent-context` prints (S4+S5 tidy: closing finished workers before `host stop` needs
  // `worker-release`, and its `--help` said "no usage").
  // A typo lands here too, and the command table is one flag away.
  if (!Object.hasOwn(USAGE, first)) {
    const session = sessionUsage(first)
    if (session !== undefined) return { text: sessionCommandUsage(first, session) }
    return {
      error: `no usage for ${first} (astera --help lists the commands, astera help documents the ones agents use)`
    }
  }
  return { text: commandUsage(first as PublicCommand) }
}

/**
 * The flags every command takes, public or not. They are read by the parser and by run.ts rather
 * than by any one command, so no `USAGE` entry lists them. cliAgentContext.ts describes each one
 * (`globalFlags`), and cliUsage.test.ts holds the two lists to the same names.
 */
export const GLOBAL_FLAGS: readonly string[] = [
  'json',
  'human',
  'quiet',
  'no-keepalive',
  'verbose',
  'project',
  'runtime',
  'request-id',
  'help'
]

/** Global flags that go **before** the command only. After the command `--project` is a command's own
 *  flag, accepted where `USAGE` declares it and refused elsewhere: accepting it on every command would
 *  let `runs get --project p` run and ignore it, the fault this check exists for. run.ts hands this
 *  check the line from the command on, so a leading `--project` never reaches it. */
const LEADING_ONLY: ReadonlySet<string> = new Set(['project', 'runtime'])

/** Flags a public command really reads that its `USAGE` entry leaves out on purpose. `--skills-dir`
 *  is the one, and the comment on `help` above says why it is not listed. */
const UNLISTED: Partial<Record<PublicCommand, readonly string[]>> = {
  help: ['skills-dir'],
  'browser-help': ['skills-dir']
}

/**
 * Why this line is refused, or `null`: a **public** command given a flag it does not declare.
 *
 * **Refused, because ignoring it was a wrong answer that looked right** (conformance audit #59).
 * `parseArgs` carries every `--x` into `args` and each command reads only the keys it knows, so
 * `runs wait --timeout 30m` waited the one-hour default and `jobs list --project p` listed every Job.
 * A script reads either as the answer it asked for.
 *
 * **No near-miss is mapped to the flag it resembles.** `--timeout` is not read as `--timeout-ms`:
 * this CLI has no aliases (public CLI design §2), and the message lists the flags the command takes,
 * which is the whole fix.
 *
 * **Session-only commands are not checked.** Their flags are declared nowhere a machine can read
 * (cliAgentContext.ts), and the guide and sessions started by older builds pass flags a command
 * ignores. Refusing those would break a running coordinator over a flag that never did anything.
 * `accounts` and `run-configs` with no verb are session commands in this sense.
 *
 * **It reads the flags off `argv`, not off the parsed arguments**, so the message names the flag as
 * it was typed. Every token that starts with `--` is a flag: `parseArgs` never takes one as a value.
 */
export function unknownFlagError(cmd: string, argv: readonly string[]): string | null {
  if (!Object.hasOwn(USAGE, cmd)) return null
  const pc = cmd as PublicCommand
  const own = (USAGE[pc].flags ?? []).map((f) => f.name)
  const allowed = new Set(
    [...own, ...(UNLISTED[pc] ?? []), ...GLOBAL_FLAGS.filter((f) => !LEADING_ONLY.has(f))].map(camel)
  )
  const unknown = argv
    .filter((t) => t.startsWith('--'))
    .map((t) => t.slice(2))
    .filter((name) => !allowed.has(camel(name)))
  if (unknown.length === 0) return null
  const named = [...new Set(unknown)].map((n) => `--${n}`).join(', ')
  const takes =
    own.length === 0
      ? `it takes no flags of its own`
      : `its flags are ${own.map((n) => `--${n}`).join(', ')}`
  return `${spelledCommand(cmd)} does not take ${named}: ${takes}, plus the global ones (--json, --human, --quiet, --no-keepalive, --verbose, --request-id)`
}

// W8-C heavy
/** `astera heavy` is answered in the CLI process before the parser (cli/run.ts): the tokens after `--` are the
 *  command's, not ours. Not in `USAGE`, because it takes no flags and is not sent to the Host. */
export const HEAVY_USAGE = [
  'usage: astera heavy -- <command> [args…]',
  '',
  '  Runs a heavy job (the full test suite, `npm run dev` / Electron, `npm run dist:linux`) under the',
  '  machine-wide lock /tmp/astera-fullsuite.lock: up to the Settings value "Heavy jobs at once" (default 1)',
  '  at a time, first come first served. Hand-opened tabs that run `flock /tmp/astera-fullsuite.lock <command>`',
  '  share slot 1. The lock is released',
  '  when the command exits or crashes. Exits with the command\'s exit code (a signal is 128+n).',
  '',
  '  example: astera heavy -- nice -n 10 npx vitest run --maxWorkers=2'
].join('\n')
