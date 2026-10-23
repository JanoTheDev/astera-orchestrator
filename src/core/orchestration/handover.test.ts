import { describe, expect, it } from 'vitest'
import { buildHandoverPrompt, buildPlannerBrief, coordinatorLaunchPrompt } from './handover'

const prompt = (over: Partial<Parameters<typeof buildHandoverPrompt>[0]> = {}): string =>
  buildHandoverPrompt({
    runId: 'run_abc',
    objective: 'refactor the auth module',
    concurrency: 3,
    taskCount: 4,
    ...over
  })

describe('buildHandoverPrompt', () => {
  it('T5: lists the standing grants, or says owner-only decisions are blocked when there are none', () => {
    const granted = prompt({ grants: ['protected-paths', 'migrations'] })
    expect(granted).toContain('The owner granted in advance: protected-paths, migrations.')
    expect(granted).toContain('write the grant yourself')
    expect(granted).toContain('do not escalate it')
    for (const p of [prompt(), prompt({ grants: [] })]) {
      expect(p).not.toContain('The owner granted in advance')
      expect(p).toContain('Owner-only decisions are blocked for the owner')
    }
  })

  it('T5: tells the coordinator to start workers one at a time, never with &, and every ready Task before its turn ends', () => {
    const p = prompt()
    expect(p).toContain('one `astera worker-start` per command')
    expect(p).toContain('never background it with `&`')
    expect(p).toContain('Before ending your turn, start every ready')
  })

  // 이 여섯 개가 계약이다 — 하나라도 빠지면 코디네이터가 지킬 수 없는 규칙이 생긴다
  // (handover.ts 의 JSDoc). 그래서 문구의 존재를 테스트가 고정한다.
  it('이 Run 은 사람이 짰다고 말한다 — 그대로 돌려라', () => {
    const p = prompt()
    expect(p).toContain('Do not create Tasks')
    expect(p).toContain('do not rewrite their specs')
    expect(p).not.toContain('PLAN THIS JOB FIRST')
  })

  // A Job from MCP create_job or `jobs create` reaches the Run with Tasks made elsewhere or none at
  // all, so the opening line must not claim the app (e2e 2026-10-01, second run).
  it('with Tasks, the opening line is true wherever the Tasks came from', () => {
    const p = prompt({ taskCount: 2 })
    expect(p).not.toContain('A person laid it out in the app')
    expect(p).toContain('Its Tasks were laid out before you joined')
  })

  // Review fix round 1, Important 1: the coordinator's session runs in the project folder itself,
  // with permissions bypassed, so nothing but the brief keeps it from doing the work itself.
  it('in both branches, the coordinator plans and places and changes no files', () => {
    for (const p of [prompt({ taskCount: 0 }), prompt({ taskCount: 3 })]) {
      expect(p).toContain('You plan and place; you do not change files.')
      expect(p).toContain("Your session runs in the project folder itself, not this Run's worktree.")
      expect(p).toContain('every edit, build or commit is done by a worker, through a Task')
      expect(p).not.toContain('Getting these Tasks done, and answering the workers you start, is your job.')
      expect(p).toContain('Getting these Tasks done by workers')
    }
  })

  // Review fix round 1, Minor 3: a predecessor stopped part-way through planning leaves Tasks that do
  // not cover the objective; "Do not create Tasks" alone left the newcomer no way to say so.
  it('with Tasks, the opening line holds for a coordinator joining late, and a plan that falls short goes to a Gate', () => {
    const p = prompt({ taskCount: 2 })
    expect(p).toContain('Its Tasks were laid out before you joined')
    expect(p).toContain('do not cover the objective')
    expect(p).toMatch(/open a Gate saying so/)
  })

  describe('with no Tasks, planning is the first job', () => {
    const p = prompt({ taskCount: 0, accountId: 'acc_me', jobId: 'job_42', runId: 'run_abc' })

    it('does not forbid creating Tasks, and says the Job came with no plan', () => {
      expect(p).not.toContain('Do not create Tasks')
      expect(p).not.toContain('THE PLAN IS ALREADY MADE')
      expect(p).not.toContain('A person laid it out')
      expect(p).toContain('PLAN THIS JOB FIRST')
      expect(p).toContain('an objective and no plan')
    })

    it('names the command, the deps, the account it runs on, and the checks', () => {
      expect(p).toContain('astera task-create --run run_abc')
      expect(p).toContain('--deps')
      expect(p).toContain('omit `--account` unless the objective names one')
      expect(p).not.toContain('--account acc_me')
      expect(p).toContain('accounts list')
      expect(p).toContain('never mix providers inside one Task')
      expect(p).toContain('astera run-configs list --job job_42')
      expect(p).toContain('--validate')
      expect(p).toContain('--review')
      expect(p).toMatch(/few Tasks/)
    })

    it('says a Gate needs a Task, so a question before any Task goes on a first Task', () => {
      expect(p).toContain('A Gate needs a Task')
      expect(p).toContain('never ask only in your own terminal')
    })

    it('says Astera closes finished workers and names worker-release', () => {
      expect(p).toContain('Astera closes a worker')
      expect(p).toContain('astera worker-release --dispatch <dispatch>')
    })

    it('keeps the rest of the brief', () => {
      for (const part of ['TAKE STOCK BEFORE YOU START ANYTHING', 'ACCOUNTS COME FROM THE TASK', 'CONCURRENCY IS 3', 'WHERE WORKERS RUN', 'YOU ARE THE INBOX', 'WHEN A PERSON IS ACTUALLY NEEDED'])
        expect(p).toContain(part)
      expect(buildHandoverPrompt({ runId: 'r', objective: 'o', concurrency: 1, taskCount: 0, convergence: true })).toContain(
        'COMPLETION CONVERGENCE IS ON'
      )
    })
  })

  it('계정이 Task 에 있고 첫 계정이 provider 라고 말한다', () => {
    const p = prompt()
    expect(p).toContain('accountIds')
    expect(p).toContain('first account decides which CLI')
    expect(p).toContain('never mix providers inside one Task')
  })

  // 값은 run-show 로 읽을 수 있었지만 지키라고 말한 적이 없었다 — 그래서 숫자를 문구에 박는다
  it('동시 실행 한도를 숫자로 박아 넣는다', () => {
    expect(prompt({ concurrency: 3 })).toContain('CONCURRENCY IS 3')
    expect(prompt({ concurrency: 3 })).toContain('more than 3 dispatch')
    expect(prompt({ concurrency: 1 })).toContain('CONCURRENCY IS 1')
  })

  // 가이드가 "the placement rule" 을 이름만 부르고 정의를 두지 않았던 자리다
  it('배치 규칙이 한도에 따라 갈리고, 이유까지 적는다', () => {
    const seq = prompt({ concurrency: 1 })
    expect(seq).toContain('omit `--worktree`')
    expect(seq).not.toContain('--worktree new')

    const par = prompt({ concurrency: 2 })
    expect(par).toContain('--worktree new --name')

    for (const p of [seq, par]) {
      expect(p).toContain('merging the work back requires a clean tree')
      expect(p).toContain('overwrite each other')
    }
  })

  it('한도가 0 이거나 음수여도 순차로 읽는다 — 손으로 고친 파일이 그럴 수 있다', () => {
    for (const concurrency of [0, -1]) {
      expect(prompt({ concurrency })).toContain('omit `--worktree`')
    }
  })

  // Push, not poll (owner 2026-10-18): the coordinator ends its turn and Astera messages it; no `--wait` loop.
  it('네가 받은편지함이고, 턴을 끝내면 Astera 가 소식을 보낸다고 말한다 — --wait 은 없다', () => {
    const p = prompt()
    expect(p).not.toContain('--wait')
    expect(p).toContain('end your turn')
    expect(p).toContain('check --json')
    expect(p).toContain('reply --id')
  })

  it('사람이 필요할 때의 자리와 그 제약을 말한다', () => {
    const p = prompt()
    expect(p).toContain('gate-create')
    expect(p).toContain('cannot be created for a Task that has an open dispatch')
    expect(p).toContain('worker-stop')
  })

  it('Run 의 식별자와 목표를 싣는다 — 코디네이터가 --run 에 쓸 값이다', () => {
    const p = prompt({ runId: 'run_zzz', objective: '숫자를 센다', taskCount: 7 })
    expect(p).toContain('run_zzz')
    expect(p).toContain('숫자를 센다')
    expect(p).toContain('tasks already defined: 7')
  })

  it('convergence Run 의 브리핑은 재시도가 앱의 일이라고 말한다', () => {
    const p = buildHandoverPrompt({ runId: 'run_1', objective: 'o', concurrency: 1, taskCount: 2, convergence: true })
    expect(p).toContain('COMPLETION CONVERGENCE IS ON')
    expect(p).toContain('do not start a worker for it')
    expect(p).toContain('worker-release')
    expect(buildHandoverPrompt({ runId: 'run_1', objective: 'o', concurrency: 1, taskCount: 2 })).not.toContain('CONVERGENCE')
  })
})

// **이 계약이 깨지면 코디네이터는 빈 화면으로 선다.** 이 문구는 세션의 argv 로 가고 win32 에서
// 세션은 `cmd.exe /c` 로 뜨므로 줄바꿈이 명령을 끊는다 — 실측으로 그렇게 잡혔다(2026-08-28:
// 코디네이터는 떴지만 Task 가 돌지 않았고 그 세션에 트랜스크립트가 없었다).
describe('coordinatorLaunchPrompt', () => {
  it('한 줄이다', () => {
    const line = coordinatorLaunchPrompt('C:/x/orch/specs/coordinator-run_1.md')
    expect(line.split('\n')).toHaveLength(1)
    expect(line).not.toMatch(/[\r\n]/)
  })

  it('그 파일을 가리키고, 무엇인지 말한다', () => {
    const line = coordinatorLaunchPrompt('C:/x/brief.md')
    expect(line).toContain('C:/x/brief.md')
    expect(line).toContain('Job you are managing')
  })

  // 브리핑 본문은 여러 줄이어도 된다 — 파일로 가기 때문이다. 그 사실을 못박아 두지 않으면
  // 다음 사람이 "한 줄" 규칙을 브리핑 쪽으로 옮겨 읽는다
  it('브리핑 본문은 여러 줄이다 — 그것이 파일로 가는 이유다', () => {
    expect(
      buildHandoverPrompt({ runId: 'run_1', objective: 'o', concurrency: 1, taskCount: 1 }).split('\n')
        .length
    ).toBeGreaterThan(10)
  })
})

describe('buildPlannerBrief planning mode (T1)', () => {
  const base = { jobId: 'job_x', objective: 'o', repoRoot: '/repo', accountId: 'acc1', concurrency: 2 }
  it('chat (the default) names the brainstorming skill and the one-question method', () => {
    for (const b of [buildPlannerBrief(base), buildPlannerBrief({ ...base, planning: 'chat' })]) {
      expect(b).toContain('superpowers:brainstorming')
      expect(b).toContain('one question at a time')
      expect(b).toContain('never ask them to attach files')
      expect(b).not.toContain('do not wait for the person')
    }
  })
  it('auto decides alone and records decisions', () => {
    const b = buildPlannerBrief({ ...base, planning: 'auto' })
    expect(b).toContain("under 'Decisions'")
    expect(b).toContain('do not wait for the person')
    expect(b).toContain('gh issue list --state open')
    expect(b).not.toContain('superpowers:brainstorming')
  })
})

describe('buildPlannerBrief wider plans', () => {
  it('asks for up to the worker limit of Tasks at once, right after the limit line', () => {
    const b = buildPlannerBrief({ jobId: 'job_x', objective: 'o', repoRoot: '/repo', accountId: 'acc1', concurrency: 7 })
    expect(b).toContain('- workers that may run at once: 7\n  Cut the plan so up to that many Tasks can run at once')
    expect(b).toContain('deps only where one needs another\'s code (planner-guide.md section 2)')
  })
})

describe('buildPlannerBrief objective coverage and the plan name (T7)', () => {
  const base = { jobId: 'job_x', objective: '1. a\n2. b', repoRoot: '/repo', accountId: 'acc1', concurrency: 2 }
  it('tells the planner to give every Task --covers, list skipped items with --left-out, and rename the Job', () => {
    const b = buildPlannerBrief(base)
    expect(b).toContain('--covers 1,3')
    expect(b).toContain(`astera jobs-set --id job_x --left-out '[{"item":2,"reason":"already built: src/x.ts"}]'`)
    expect(b).toContain('astera jobs rename --id job_x --title "<3-6 words>"')
    expect(b).toContain('a chat-planned Job starts with no real objective')
    expect(buildPlannerBrief({ ...base, planning: 'auto' })).not.toContain('a chat-planned Job')
  })
})

describe('buildPlannerBrief (W7-E #69)', () => {
  it('lets the planner write its inputs folder, and nothing else', () => {
    const b = buildPlannerBrief({ jobId: 'job_x', objective: 'o', repoRoot: '/repo', accountId: 'acc1', concurrency: 2 })
    expect(b).toContain('$ASTERA_PROFILE_DIR/plans/job_x/inputs/')
    expect(b).toContain('existing.md')
    expect(b).toContain('audit.md')
    expect(b).not.toContain('Do not edit, create or delete files, run builds, or commit.')
  })
})

// T3: the app places a coordinator Run's ready Tasks; the coordinator keeps the rest.
describe('who starts workers', () => {
  it('when the app places, the coordinator is told not to start ready Tasks and what stays its job', () => {
    const p = prompt({ appPlaces: true })
    expect(p).toContain('WHO STARTS WORKERS')
    expect(p).toContain('Astera starts a worker for each ready Task itself')
    expect(p).toContain('Do not start ready Tasks yourself')
    expect(p).toContain('that refusal is not an error')
    for (const part of ['questions and Gates', 'failures and repairs', '--retry-of', 'reviews', 'delivery'])
      expect(p).toContain(part)
    expect(p).toContain('A Task that becomes ready needs nothing from you')
    expect(p).not.toContain('the app starts no workers for this Run')
  })
  it("a scheduled Job's coordinator still places, as before", () => {
    const p = prompt({ appPlaces: false })
    expect(p).toContain('the app starts no workers for this Run')
    expect(p).not.toContain('WHO STARTS WORKERS')
    expect(p).not.toContain('needs nothing from you')
  })
  it('a prompts-mode plan the app places says Astera starts the ready ones', () => {
    expect(prompt({ promptsMode: true, appPlaces: true })).toContain('do not task-update them. Astera starts the ready ones.')
  })
})

describe('prompts-mode Job (Run as written)', () => {
  const START = 'The Tasks are already planned and approved; do not task-update them. Start the ready ones.'
  it('coordinator brief has the start line and no fill-in text', () => {
    const p = prompt({ promptsMode: true, objective: 'Run as written: the owner\'s prompts are this plan\'s Tasks.' })
    expect(p).toContain(START)
    expect(p).not.toContain('--affected-paths')
    expect(p).not.toContain('Fill in each one')
    expect(prompt()).not.toContain(START)
  })
  it('planner brief keeps the fill-in instruction only in prompts mode', () => {
    const a = { jobId: 'j', objective: 'o', repoRoot: '/r', accountId: 'a', concurrency: 1 }
    expect(buildPlannerBrief({ ...a, promptsMode: true })).toContain('Fill in each one: --affected-paths')
    expect(buildPlannerBrief(a)).not.toContain('Fill in each one')
  })
})

describe('#117 hands-off coordinator brief', () => {
  it('tells a hands-off coordinator to decide escalations itself, with its reason, inside the guardrails', () => {
    const a = { runId: 'run_1', objective: 'o', concurrency: 1, taskCount: 2 }
    const p = buildHandoverPrompt({ ...a, handsOff: true })
    expect(p).toContain('THIS PLAN IS HANDS-OFF')
    expect(p).toContain('astera questions answer --id <msg>')
    expect(p).toContain('Never ask the owner')
    expect(p).toContain('no force-push')
    expect(buildHandoverPrompt(a)).not.toContain('HANDS-OFF')
  })
})
