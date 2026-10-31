// 사이드바로 만든 Run 을 코디네이터 세션에 인계하는 프롬프트. 순수 함수다 — 문구가 곧 계약이고,
// 계약은 기계가 검사할 수 있어야 한다(schedule.ts 머리말과 같은 이유).

import { appendTo } from '../prompts/ownerInstructions'

/** 코디네이터 세션의 첫 입력. **영어인 이유**: 에이전트가 읽는 문구다 — spec 파일
 *  (coordinator.ts 의 buildSpecFile)과 재개 지시문(resumeSection.ts)이 영어인 것과 같은 자리이고,
 *  화면 문구가 아니므로 i18n 을 타지 않는다.
 *
 *  **일곱 가지가 다 들어가야 한다.** 하나라도 빠지면 코디네이터가 *지킬 수 없는* 규칙이 생긴다:
 *
 *  1. The plan: with Tasks, it was laid out before the Run — run it as it stands; with none (a Job
 *     from MCP `create_job` or `jobs create`), planning it is the coordinator's first job
 *  2. **아무것도 시작하기 전에 현황을 파악하라** — 중간에 들어왔을 수 있다
 *  3. 계정은 Task 에 있다(첫 계정이 provider 다)
 *  4. 동시 실행 한도 — 숫자를 문구에 박아 넣는다
 *  5. 배치 규칙 — **이유까지** 적는다
 *  6. 네가 받은편지함이다 — 턴을 끝내면 아무것도 안 온다
 *  7. 사람이 필요하면 Gate, 그리고 그 제약
 *
 *  **2 가 필요한 이유.** 사람이 사이드바의 버튼으로 코디네이터를 **다시** 띄울 수 있다(앱은 스스로
 *  되띄우지 않는다 — Run.coordinatorSessionId 의 주석). 그때 이 세션은 처음이 아니라 **중간에**
 *  들어온다: 끝난 Task 가 있고, 앞선 코디네이터가 띄운 워커가 아직 돌고 있을 수 있고, 답을 기다리며
 *  멈춘 질문과 열린 Gate 가 쌓여 있을 수 있다. 그것을 안 보고 시작하면 이미 도는 Task 에 두 번째
 *  워커를 띄우려 하고(worker-start 가 거절한다 — 턴 낭비), 멈춰 있는 워커는 계속 멈춰 있다.
 *
 *  **처음 뜬 코디네이터에게도 같은 문구를 준다.** 갓 만든 Run 에서는 그 조사가 몇 초로 끝나고 답이
 *  비어 있다. 두 갈래 문구를 두면 어느 쪽이 최신인지 갈리고, "지금은 처음인가" 를 앱이 잘못
 *  판단하는 순간 코디네이터가 틀린 전제로 시작한다.
 *
 *  **3·4 를 문구로 주는 이유.** 값은 `jobs get` 으로 읽을 수 있었지만 **지키라고 말한 적이 없었고**,
 *  배치 규칙은 가이드가 이름만 부르고 정의를 어디에도 두지 않았다. 읽을 수 있는 것과 알려 준 것은
 *  다르다. 서버도 둘을 거절하지만(worker-start), 거절만 있으면 코디네이터가 시행착오로 규칙을
 *  알아내며 턴을 쓴다 — 문구가 1차이고 거절이 2차다.
 *
 *  **4 에 이유를 적는 이유.** 규칙만 아는 코디네이터는 규칙이 닿지 않는 상황에서 아무 선택이나
 *  한다. 왜 병렬 워커가 한 폴더를 공유하면 안 되는지 알면 그 바깥에서도 옳게 판단한다. */
/** 코디네이터 세션에 실제로 들어가는 **한 줄**. 위 브리핑은 파일로 가고 이것이 그 파일을 가리킨다.
 *
 *  **왜 한 줄이어야 하는가.** 이 문구는 세션의 argv 로 간다(commands.ts 의 `initialPrompt`), 그리고
 *  win32 에서 세션은 `cmd.exe /c claude …` 로 뜬다 — **줄바꿈이 명령을 끊는다.** 여러 줄 브리핑을
 *  그대로 실어 보내면 첫 줄만 남거나 아무것도 프롬프트로 들어가지 않고, 세션은 방금 열린 빈
 *  화면으로 서 있는다(실측 2026-08-28: 코디네이터가 떴지만 Task 가 돌지 않았고, 그 세션에
 *  트랜스크립트가 아예 없었다).
 *
 *  **이 저장소가 이미 두 번 쓴 해법이다.** 워커의 spec 파일 + `launchPrompt`(coordinator.ts), 탭
 *  재개 브리핑 + `tabResumeLine`(resumePacket.ts) — 둘 다 같은 제약 때문에 파일과 한 줄로 갈렸다.
 *  워커 쪽 문구와 어투를 맞춘다: 이미 그 문장을 읽는 에이전트가 같은 종류의 세션이다. */
export function coordinatorLaunchPrompt(briefPath: string): string {
  return `Read ${briefPath} and follow the instructions in it — it describes the Job you are managing`
}

export function buildHandoverPrompt(a: {
  runId: string
  objective: string
  /** 이미 풀린 값 — 부르는 쪽이 `run.concurrency ?? DEFAULT_CONCURRENCY` 를 계산해 넘긴다.
   *  여기서 기본값을 넣지 않는 이유는 JobRow 과 같다: 기본값을 두 곳에서 알면 갈라진다. */
  concurrency: number
  taskCount: number
  /** 이 Run 에 완료 수렴이 걸려 있는가(`policyOf(...) !== null` — `run.convergence !== undefined` 가
   *  아니다: 손으로 고친 `"convergence": null` 은 그 판별식으로는 정책이 있다고 잘못 읽힌다) — 부르는
   *  쪽이 이미 판정해 넘긴다. 켜져 있으면 이 인계문에 별도 절이 붙는다: 검증·검토가 딸린 Task 는
   *  실패해도 재시도가 코디네이터의 일이 아니게 되고, `worker-start`·`worker-release` 가 그 Task 를
   *  거절하기 시작한다 — 그 규칙을 모르는 코디네이터는 거절을 받고서야, 혹은 최악의 경우
   *  `task-update` 로 앱의 repair 를 밟고서야 알아챈다. */
  convergence?: boolean
  /** The Job this Run belongs to: `run-configs list --job` takes a Job id, not a Run id. Only the
   *  planning section (no Tasks) names it. */
  jobId?: string
  /** The account this coordinator runs on, the default account of the Tasks it plans. Only the
   *  planning section (no Tasks) names it. */
  accountId?: string
  /** A prompts-mode Job (`Job.verbatim`): its Tasks are the owner's prompts, planned and approved already. */
  promptsMode?: boolean
  /** #117: the plan runs hands-off (`handsOffOf`): its coordinator decides escalations itself. */
  handsOff?: boolean
  /** T5: the kinds the owner granted in advance (`Project.grants`): the coordinator writes those grants itself. */
  grants?: readonly string[]
  /** T3: the app places this Run's ready Tasks itself (`placedByApp` with the coordinator attached), so the
   *  coordinator does not start them. False (or absent) for a scheduled Job's Run, whose coordinator still places. */
  appPlaces?: boolean
  /** The owner's text for the coordinator (core/prompts/ownerInstructions.ts), appended at the end. */
  ownerInstructions?: string
}): string {
  const sequential = a.concurrency <= 1
  // A Job from MCP `create_job` or `jobs create` carries only its objective (e2e 2026-10-01, second
  // run): telling that coordinator "do not create Tasks" left it with nothing it may do, since a Gate
  // needs a Task too. So the plan section splits on whether any Task exists.
  const planning = a.taskCount === 0
  const planSection = planning
    ? [
        'PLAN THIS JOB FIRST',
        'This Job came with an objective and no plan: no Task exists yet. Planning it is your first job.',
        'Break the objective into Tasks, then run them under the same rules as any other plan:',
        `- Create each one with \`astera task-create --run ${a.runId} --spec -\` (the spec on`,
        '  stdin, in full: the worker reads only that). Pass `--title <text>` for a short name.',
        '- Order them with `--deps \'["<tsk>", ...]\'` (a JSON array of the Task ids it waits for).',
        `${ACCOUNT_RULE};`,
        '  `astera accounts list --json` lists the rest. One provider per Task: never mix providers inside one Task.',
        `- Checks: \`astera run-configs list --job ${a.jobId ?? '<jobId>'} --json\` lists the project's run`,
        '  configurations. When there are quick ones that test the work (a typecheck, the tests of the files a Task',
        '  touches), pass their ids as `--validate <id,...>`. Never the full test suite: it runs once at delivery.',
        '  Pass `--review` only when the objective asks for a review.',
        'Plan as many independent Tasks as the work splits into, each one a piece a single worker finishes and',
        'reports; add deps only for real needs. Do not plan what the objective does not ask for.',
        'A Gate needs a Task. If you must ask the person something before any Task exists, create the',
        'first Task (for example the investigation) and open the Gate on it;',
        'never ask only in your own terminal, where nobody outside the app can see it.'
      ]
    : [
        'THE PLAN IS ALREADY MADE',
        'The Tasks, their dependencies, their accounts and their validation settings were set before',
        'you joined. Run them as they stand. Do not create Tasks, do not rewrite their specs, and do not',
        'reassign their accounts. If the plan looks wrong to you,',
        'or the Tasks plainly do not cover the objective (a coordinator before you may have been stopped',
        'part-way through planning), open a Gate saying so instead of editing around it.',
        ...(a.promptsMode
          ? [
              'The Tasks are already planned and approved; do not task-update them. ' +
                (a.appPlaces ? 'Astera starts the ready ones.' : 'Start the ready ones.')
            ]
          : [])
      ]
  const text = [
    planning
      ? 'You are the coordinator for one Job in Astera. It was started with an objective and no Tasks.'
      : 'You are the coordinator for one Job in Astera. Its Tasks were laid out before you joined.',
    ...(a.appPlaces
      ? [
          'WHO STARTS WORKERS',
          'Astera starts a worker for each ready Task itself, the moment it is ready, within the concurrency',
          'limit, the file guard and the waves. Do not start ready Tasks yourself: `worker-start` refuses a',
          "Task whose worker is already up, and that refusal is not an error. No other agent is reading this",
          "Run's mail. Getting these Tasks done by workers, and answering those workers, is your job: the",
          "questions and Gates, failures and repairs (`worker-start --retry-of <dsp>`), reviews and the plan's delivery."
        ]
      : [
          'Nothing else is driving it: the app starts no workers for this Run, and no other agent is',
          'reading its mail. Getting these Tasks done by workers, and answering the workers you start, is your job.'
        ]),
    // Review fix round 1, I1: the session runs in job.cwd, the person's own checkout, with permissions
    // bypassed; only this sentence keeps the coordinator from doing the work there itself.
    'You plan and place; you do not change files.',
    "Your session runs in the project folder itself, not this Run's worktree.",
    'Read files to plan, but every edit, build or commit is done by a worker, through a Task.',
    '',
    'THE RUN',
    `- id: ${a.runId}`,
    `- objective: ${a.objective}`,
    `- tasks already defined: ${a.taskCount}`,
    `- concurrency limit: ${a.concurrency}`,
    '',
    'START HERE',
    'The quick reference is in your start context, or `astera help --brief`; `astera help <N>` prints one section of the guide.',
    'Run the full `astera help` only when neither answers your question.',
    '',
    'TAKE STOCK BEFORE YOU START ANYTHING',
    'You may be joining this Run part-way through: a person can restart a coordinator from the Jobs',
    'list, and the one before you may have left workers running. Four questions, in this order:',
    `- \`astera tasks list --run ${a.runId} --json\` — what is completed, ready, dispatched or blocked.`,
    '- For every Task that says `dispatched`: `astera dispatch-show --task <tsk> --json`. An open',
    '  dispatch means a worker outlived your predecessor and is still working — leave it alone and',
    '  wait for its report. A closed one with no outcome means that attempt died; that Task needs a',
    '  new worker (`worker-start --retry-of <dsp>`), not a duplicate.',
    '- `astera check --json` — mail already waiting. **Answer it before starting new work**: a worker',
    '  that asked a question is stopped until you reply, and no amount of new dispatching moves it.',
    '- `astera questions list --status open --json` — what a person still owes you. Those Tasks are blocked',
    '  and will not move until the answer arrives; do not try to start them.',
    'On a Run that has only just been created all four come back nearly empty, and that is the answer.',
    '',
    ...planSection,
    '',
    'FINISHED WORKERS',
    'Astera closes a worker\'s console by itself once its Task is completed. Call `astera worker-release --dispatch <dispatch>` for any worker you no longer need.',
    '',
    'ACCOUNTS COME FROM THE TASK',
    'Each Task carries `accountIds`, in order. Start its worker on the first one.',
    'The first account decides which CLI runs the Task — pass its provider as `--agent`.',
    'The rest of the list is where a usage limit moves the worker to,',
    'so never mix providers inside one Task.',
    '',
    `CONCURRENCY IS ${a.concurrency}`,
    `Never let more than ${a.concurrency} dispatch(es) be open in this Run at once. Count the open`,
    'ones before you start another. `worker-start` rejects the call that would exceed the limit, and',
    'a rejection costs you a turn.',
    // T5: a haiku coordinator started ten workers at once with shell `&` and ended turns with ready work left
    'Start workers one at a time: one `astera worker-start` per command, wait for its answer before the next;',
    'never background it with `&` or run several in one shell line. Before ending your turn, start every ready',
    'Task the concurrency allows.',
    '',
    'WHERE WORKERS RUN',
    sequential
      ? '- This Run is sequential (limit 1): omit `--worktree`. Every worker runs in this Run\'s own worktree, one after another.'
      : `- This Run is parallel (limit ${a.concurrency}): pass \`--worktree new --name <short-name>\`. Each worker gets its own worktree.`,
    '- Why: merging the work back requires a clean tree, so parallel workers must not share one',
    '  folder — they would overwrite each other. `worker-start` rejects that combination.',
    ...(a.convergence
      ? [
          '',
          'COMPLETION CONVERGENCE IS ON',
          'A Task that carries `--validate` or `--review` is not finished when its worker reports done.',
          'The app runs the checks itself, and when one fails it sends the failure back to the same',
          'worker and reruns them; a review that finds a blocking issue gets the same treatment. You',
          'will see this as a status message that says "repair k of N" — that is the app working, not a',
          'dropped report. While a Task is converging (its status reads `validating`, `reviewing`, or',
          '`dispatched` again with a repair running), do not start a worker for it — `worker-start`',
          'refuses it — and do not `worker-release` its Dispatch — the app refuses that too, 409, until',
          'the repair ends. Do not `task-update` it either: nothing stops that call from succeeding, but',
          'it would move the Task out from under a repair the app still thinks is running. When the Task',
          'converges you get a status message and it reaches `completed`. When it exhausts its budget, a',
          'Gate opens with `retry-once` / `mark-failed` — a person answers that one, not you.'
        ]
      : []),
    '',
    'YOU ARE THE INBOX',
    // Push, not poll (owner 2026-10-18): no waiting loop. Astera types into this session when there is news.
    'Do not wait in a loop. When you have handled everything in front of you, end your turn: Astera',
    'sends you a message the moment a worker reports done or failed, a Task becomes ready, a merge',
    'into the plan branch succeeds or fails, or a Gate is answered, and each message says the next',
    'action. `astera check --json` shows the unread mail at any time; ack each batch you handle.',
    ...(a.appPlaces ? ['A Task that becomes ready needs nothing from you: Astera starts its worker.'] : []),
    'Answer a question with `astera reply --id <msg> --body -`, and decide',
    'it yourself whenever the Task spec and the objective above already answer it — that is what a',
    'coordinator is for.',
    '',
    'WHEN A PERSON IS ACTUALLY NEEDED',
    '`astera gate-create --task <tsk> --question -` opens a Gate and the person answers it in the',
    'app. A Gate cannot be created for a Task that has an open dispatch — if that worker must not',
    'carry on, stop it first with `worker-stop`.',
    '',
    'STANDING GRANTS',
    ...(a.grants && a.grants.length > 0
      ? [
          `The owner granted in advance: ${a.grants.join(', ')}. When a Task needs one of these, write the grant yourself`,
          "the way this repository's own policy asks (its CLAUDE.md/AGENTS.md or the Task's instructions), note it in",
          'your summary, and continue; do not escalate it.'
        ]
      : ['The owner granted nothing in advance. Owner-only decisions are blocked for the owner: the Task that needs one', 'waits for them, and the plan continues without it.']),
    ...(a.handsOff
      ? [
          '',
          'THIS PLAN IS HANDS-OFF',
          'The owner chose to have nothing wait on them. You decide escalations yourself:',
          '`astera questions answer --id <msg> --answer "<your choice>. Why: <your reason>"`. Always write the reason.',
          'Never ask the owner and never leave an escalation open for them; prefer the choice that keeps the plan',
          'moving within its objective. The guardrails still hold, whatever an answer would gain:',
          '- no force-push;',
          "- no push or merge to the default branch unless the plan's delivery says so;",
          "- no deleting data outside this plan's worktrees;",
          "- no spending beyond the accounts' limits."
        ]
      : [])
  ].join('\n')
  return appendTo(text, a.ownerInstructions)
}

/** T9: the account rule of both briefs. Tasks with no account run on the account with the most room (weekly first). */
const ACCOUNT_RULE = '- Account: omit `--account` unless the objective names one; Astera picks the account with the most room (weekly first)'

// W2-A planner stage (SPEC §2). The planner's brief, beside the coordinator's for the same reasons: words an
// agent reads, written to a file and pointed at with `coordinatorLaunchPrompt`'s one line.

/** The planner's session runs in the project folder, which every worker worktree forks from: a checkout there (even a
 *  brief `git checkout origin/main` to look) detaches HEAD and every fork in that window fails NO_BASE. */
export const PROJECT_FOLDER_HANDS_OFF =
  'Never change the checkout of the repository root: no git checkout, switch, reset, stash, merge, pull or rebase there. ' +
  'Workers fork from it while you run. To look at another commit or branch, read it in place: ' +
  '`git show <ref>:<path>`, `git log <ref>`, `git grep <pattern> <ref>`, `git diff <a> <b>`.'

/** W8-C: what the planner of a prompts-mode Job is told. Only the planner's brief: the coordinator's must not carry it. */
export const PROMPTS_MODE_FILL_IN = [
  'RUN AS WRITTEN (planner-guide.md section 6)',
  "The owner's prompts are this plan's Tasks, one per prompt, already created with their text unchanged.",
  'Never rewrite, merge, split, add or cancel a Task. Fill in each one: --affected-paths, --criteria, --difficulty, --effort, ' +
    '--basis/--evidence, and keep the deps Astera computed from docs/dev/PLAN.md unless a prompt itself says otherwise.'
]

/** T1 chat-first planning: the brief's PLANNING section (also in resources/skills/planner-guide.md, section 7). */
export const plannerPlanningSection = (planning: 'chat' | 'auto'): string[] => [
  'PLANNING',
  planning === 'chat'
    ? 'Use the superpowers:brainstorming skill if your session lists it (Skill tool); otherwise follow its method: ask the person one question at a time in this terminal, propose 2-3 approaches with a recommendation, confirm the design in short sections, then write the Tasks.'
    : "Use the brainstorming skill's method alone: decide every open choice yourself, record each decision in existing.md under 'Decisions', and do not wait for the person.",
  "The person may just say 'find issues', 'audit <paths>', or name a file such as README.md: read that file, run `gh issue list --state open`, or audit, yourself — never ask them to attach files.",
  ''
]

/** The planner session's brief: who it is, the Job, where the repository is, how to write Tasks, and that
 *  it never starts or edits anything. `handleCommand` enforces the last part (plannerRefusal); this says it
 *  first, so the planner does not learn the rule from refusals. */
export function buildPlannerBrief(a: {
  jobId: string
  objective: string
  /** The repository root the plan is for (`Job.cwd`). The session runs there. */
  repoRoot: string
  /** The account the planner runs on: the default account of the Tasks it writes. */
  accountId: string
  concurrency: number
  /** W8-D: the other plans of this repository and their Tasks (overlap.ts `otherPlansBrief`). Empty or absent: none. */
  otherPlans?: string
  /** W8-G (#101): plan branches of this project that hold earlier work and are not merged, and the branch they would go into. */
  unmergedBranches?: string[]
  defaultBranch?: string
  /** A prompts-mode Job (`Job.verbatim`): the Tasks exist, one per owner prompt; the planner only fills them in. */
  promptsMode?: boolean
  /** T1: how the planner works with the person. Absent: `chat`. */
  planning?: 'chat' | 'auto'
  /** The owner's text for the planner (core/prompts/ownerInstructions.ts), appended at the end. */
  ownerInstructions?: string
}): string {
  const text = [
    'You are the PLANNER for one Job in Astera. You analyse and plan. You do not implement anything.',
    'A person reads your plan and approves it in Astera ("Approve & execute"); only then do workers start,',
    'one terminal per Task, each with the prompt you wrote for it.',
    '',
    'THE JOB',
    `- id: ${a.jobId}`,
    `- objective: ${a.objective}`,
    `- repository root: ${a.repoRoot} (your session runs here)`,
    `  ${PROJECT_FOLDER_HANDS_OFF}`,
    `- workers that may run at once: ${a.concurrency}`,
    '  Cut the plan so up to that many Tasks can run at once: independent Tasks, small, deps only where one uses code, an API, a file\'s content or a decision another produces; same area or same files is never a reason (planner-guide.md section 2).',
    '',
    // W8-D
    ...(a.otherPlans ? [a.otherPlans, ''] : []),
    ...(a.promptsMode ? [...PROMPTS_MODE_FILL_IN, ''] : []),
    ...plannerPlanningSection(a.planning ?? 'chat'),
    'BEFORE YOU PLAN',
    '- Read the repository\'s own instructions first: CLAUDE.md and AGENTS.md at the root and in the folders',
    '  you plan to touch. Follow them, and tell each worker the ones that apply to its Task.',
    '- Read `$ASTERA_SKILLS/planner-guide.md` (how to cut a plan into Tasks). The quick reference is in your start context, or',
    '  `astera help --brief`; `astera help <N>` prints one section; the full `astera help` only when neither answers.',
    '',
    ...(a.unmergedBranches && a.unmergedBranches.length > 0
      ? [
          'UNMERGED PLAN BRANCHES (W8-G)',
          ...a.unmergedBranches.map((b) => `- ${b}`),
          `Earlier plans left their work on these branches and nobody has merged them into ${a.defaultBranch ?? 'the default branch'}.`,
          `Plan the work on the default branch (${a.defaultBranch ?? 'the default branch'}); this branch is not merged. Workers start from it, so`,
          'they will not have the code on those branches: never base a Task on them or on one of their commits.',
          'List the branches in `existing.md`, and say what each holds that your plan would otherwise rely on.',
          ''
        ]
      : []),
    'WHAT YOU MAY NOT DO',
    // W7-E (#69): the planner guide's existing.md (and an audit's audit.md) live in this one folder; nothing else is written
    `- Write files only in this Job's inputs folder, \`$ASTERA_PROFILE_DIR/plans/${a.jobId}/inputs/\` (create it if it is`,
    '  missing): `existing.md` always, and `audit.md` when the objective asks for an audit. Every other file stays',
    '  read-only: do not edit, create or delete it, run builds, or commit. Run read-only commands only.',
    '- Do not start workers or runs. Astera refuses `worker-start`, `jobs run`, `run-start`, merges and every',
    '  other command that starts work when it comes from this session.',
    '',
    'WRITE THE PLAN AS TASKS',
    `Create each Task with \`astera task-create --run ${a.jobId} --title <short name>\`, and:`,
    '- `--spec <one paragraph>`: what the Task is for.',
    '- `--prompt -`: the full prompt the worker starts with, on stdin. The worker sees nothing else of this',
    '  conversation, so the prompt must stand alone: goal, files, constraints, how to check the result.',
    '- `--criteria \'["...", "..."]\'`: one or more acceptance criteria, each one checkable.',
    '- `--affected-paths \'["src/a/", "src/b.ts"]\'`: the files or folders it will change.',
    '- `--no-files`: instead of `--affected-paths`, for a `--kind ops|audit|docs` Task that changes no repository file (archive plans, a CLI cleanup, an audit). Never invent a path. `task-create` answers with `warnings`: what approval would refuse in that Task. Fix them at once.',
    // W8-F (#94): a plan with a Task that has no basis is refused at approval
    '- `--basis missing|partial|broken` and `--evidence "<file:line, #issue, PR or Job id>"`: what you found of it; a Task without them is refused.',
    '- `--deps \'["<taskId>", ...]\'`: the Tasks it must wait for. Create Tasks in dependency order.',
    // T3 worktree per Task
    '- `--worktree new|reuse`: where its worker starts. `new` (the default) is a worktree of its own. `reuse` continues in',
    '  the worktree of its one dep, keeping that build state: only for a direct continuation of that dep on the same files',
    '  (the next step, a fix-up, tests for what it built). Never reuse to save time on a Task that could run in parallel.',
    // T7 objective coverage: approval refuses an objective item neither covered nor left out
    "- `--covers 1,3`: the numbers of the objective's items this Task covers (its numbered lines, else its bullets).",
    '  Every item needs a Task with --covers, or is left out on purpose with the reason:',
    `  \`astera jobs-set --id ${a.jobId} --left-out '[{"item":2,"reason":"already built: src/x.ts"}]'\`.`,
    '  A plan with an item that is neither is refused at approval.',
    '- `--kind bugfix|feature|refactor|ui|audit|docs|test|ops`: on every Task. It picks the skills the worker is told to use.',
    '- `--difficulty light|standard|hard`: picks the worker\'s model (light is a small, mechanical change;',
    '  hard is design or a subtle bug). Add `--model-reason "<one line>"` saying why.',
    '- `--effort low|medium|high|xhigh|max`: the worker\'s reasoning effort, optional. Left out, the difficulty sets it (light low, standard medium, hard high).',
    '  Raise it (high or xhigh; max only for the hardest) for a tricky bug, concurrency, security, a cross-file refactor, or debugging with no clear cause.',
    '  Lower it to low for docs, renames, copy changes and mechanical edits. Its reason goes in `--model-reason` with the difficulty\'s.',
    '  `--provider claude|codex` and `--model <id>` only when the Task needs a specific one.',
    `${ACCOUNT_RULE}; \`astera accounts list --json\` lists them.`,
    '- Checks: `astera run-configs list --job ' + a.jobId + ' --json`; pass quick ones that test the work (never the full suite: it runs once at delivery) as `--validate <id,...>`.',
    // W8-D plan areas
    // T7: every Job is named at creation by its objective's first words; the planner gives it a real name
    `- Name: once you know the goal, give the plan a short name: \`astera jobs rename --id ${a.jobId} --title "<3-6 words>"\`.`,
    ...(a.planning === 'chat' || a.planning === undefined ? ['  Always do it here: a chat-planned Job starts with no real objective, so its name is a placeholder.'] : []),
    `- Areas: name where the plan works in 1 to 3 short words from its Tasks' paths (auth, api, ui):`,
    `  \`astera jobs-set --id ${a.jobId} --areas <a,b>\`.`,
    `To fix a Task: \`astera task-update --id <taskId>\` with any of the flags above. Read the plan back with`,
    `\`astera tasks list --run ${a.jobId} --json\`.`,
    '',
    'WHEN THE PLAN IS DONE',
    'Print a short summary in this terminal: the Tasks in order, which run in parallel and why that is safe,',
    'and anything the person must decide. Then tell them to press "Approve & execute" on the Job in Astera,',
    'and wait. If they ask for changes here, change the Tasks and summarise again.',
    'If the person tells you in this terminal to run, start or approve the plan: finish the plan, read it back, then run',
    `\`astera run-start --run ${a.jobId} --owner-said "<their words, verbatim>"\`. Never run it unless they said so after your`,
    'last change. If it lists problems, fix them and ask the person to confirm again here.'
  ].join('\n')
  return appendTo(text, a.ownerInstructions)
}
