// T10: a failed Task of a hands-off plan with no coordinator is retried, then accepted or escalated.
import { describe, expect, it } from "vitest";
import { emptyState, type OrchState } from "../state";
import {
  FAILED_WAIT_OPTIONS,
  failedWaitQuestion,
  resolveFailedWait,
  stallOf,
} from "../replan";
import {
  FAILURE_LIMIT,
  type CheckResult,
  type Dispatch,
  type Job,
  type JobRun,
  type Task,
} from "../types";
import {
  checksPass,
  committedWork,
  failedRetriesDue,
  failedRetryAt,
  failedRetryOf,
  HEAD_WAIT_MS,
} from "./failedRetry";

const FAILED_AT = "2026-10-31T10:00:00.000Z";
const at = (ms: number): number => Date.parse(FAILED_AT) + ms;
const MIN = 60_000;

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  runId: "run_1",
  title: id,
  spec: "s",
  deps: [],
  status: "ready",
  accountIds: ["acc1"],
  consecutiveFailures: 0,
  createdAt: FAILED_AT,
  updatedAt: FAILED_AT,
  ...over,
});

const attempt = (
  taskId: string,
  n: number,
  over: Partial<Dispatch> = {},
): Dispatch => ({
  id: `dsp_${taskId}_${n}`,
  taskId,
  provider: "claude",
  accountId: "acc1",
  sessionId: `ses_${taskId}_${n}`,
  cwd: "C:\\wt\\t",
  specPath: "/s.md",
  startedAt: `2026-10-31T0${n}:00:00.000Z`,
  workerState: "stopped",
  outcome: "failed",
  endedAt: `2026-10-31T0${n}:30:00.000Z`,
  retained: false,
  ...over,
});

const passed = (over: Partial<CheckResult> = {}): CheckResult => ({
  configId: "cfg_test",
  name: "test",
  status: "passed",
  endedAt: "2026-10-31T09:40:00.000Z",
  ...over,
});

/** A hands-off plan the app places (no coordinator), one Run: f failed, d waits on it. */
const state = (
  f: Partial<Task>,
  o: {
    job?: Partial<Job>;
    run?: Partial<JobRun>;
    dispatches?: Dispatch[];
    extra?: Task[];
  } = {},
): OrchState => ({
  ...emptyState(),
  jobs: [
    {
      id: "job_1",
      objective: "o",
      cwd: "C:\\p",
      createdAt: FAILED_AT,
      autoDispatch: true,
      concurrency: 5,
      handsOff: true,
      replan: "off",
      ...o.job,
    },
  ],
  runs: [
    {
      id: "run_1",
      jobId: "job_1",
      ordinal: 1,
      createdAt: FAILED_AT,
      worktree: "C:\\wt",
      ...o.run,
    },
  ],
  tasks: [
    task("f", {
      status: "failed",
      consecutiveFailures: 1,
      result: "tests\nfailed in  parser",
      ...f,
    }),
    task("d", { deps: ["f"], status: "pending" }),
    ...(o.extra ?? []),
  ],
  dispatches: o.dispatches ?? [attempt("f", 1)],
});

const noCoordinator = (): boolean => false;
const stepOf = (s: OrchState, nowMs: number, coordinatorLive = false) =>
  failedRetryOf(
    s,
    s.tasks.find((t) => t.id === "f")!,
    { coordinatorLive, nowMs },
  );

/** f on its last try: three failed attempts in one worktree, the first from base `aaaaaaa`. */
const lastTry = (
  f: Partial<Task>,
  head: string | undefined,
  o: { job?: Partial<Job> } = {},
): OrchState =>
  state(
    { consecutiveFailures: FAILURE_LIMIT, ...f },
    {
      ...o,
      dispatches: [
        attempt("f", 1, { git: { base: "aaaaaaa", head: "bbbbbbb" } }),
        attempt("f", 2, {
          cwd: "c:/wt/t/",
          git: { base: "bbbbbbb", head: "ccccccc" },
        }),
        attempt("f", 3, {
          git:
            head === undefined
              ? { base: "ccccccc" }
              : { base: "ccccccc", head },
        }),
      ],
    },
  );

describe("failedRetryAt", () => {
  it("backs off 1 minute after the 1st failure and 5 after the 2nd, none once the tries are used up", () => {
    expect(
      failedRetryAt({ consecutiveFailures: 1, updatedAt: FAILED_AT }),
    ).toBe(new Date(at(MIN)).toISOString());
    expect(
      failedRetryAt({ consecutiveFailures: 2, updatedAt: FAILED_AT }),
    ).toBe(new Date(at(5 * MIN)).toISOString());
    expect(
      failedRetryAt({
        consecutiveFailures: FAILURE_LIMIT,
        updatedAt: FAILED_AT,
      }),
    ).toBeUndefined();
  });
});

describe("failedRetryOf: retry while tries are left", () => {
  it("retries the 1st failure after 1 minute: attempt 2 of 3, with why it failed", () => {
    const s = state({});
    expect(stepOf(s, at(30_000))).toMatchObject({
      kind: "retry",
      due: false,
      attempt: 2,
    });
    expect(stepOf(s, at(MIN))).toMatchObject({
      kind: "retry",
      due: true,
      attempt: 2,
      why: "tests failed in parser",
      at: new Date(at(MIN)).toISOString(),
    });
  });

  it("retries the 2nd failure after 5 minutes: attempt 3 of 3", () => {
    const s = state({ consecutiveFailures: 2 });
    expect(stepOf(s, at(4 * MIN))).toMatchObject({
      kind: "retry",
      due: false,
      attempt: 3,
    });
    expect(stepOf(s, at(5 * MIN))).toMatchObject({
      kind: "retry",
      due: true,
      attempt: 3,
    });
  });

  it("a retry carried out keeps the failure count, so the next failure is the next try", () => {
    const s = state({ consecutiveFailures: 2 });
    const r = resolveFailedWait(
      s,
      "f",
      "retry",
      new Date(at(5 * MIN)).toISOString(),
      { keepFailures: true },
    );
    expect(r.ok && r.value).toMatchObject({
      status: "ready",
      consecutiveFailures: 2,
    });
  });

  it("handles a failed Task that holds nothing back too", () => {
    const s: OrchState = {
      ...state({}),
      tasks: [
        task("f", { status: "failed", consecutiveFailures: 1 }),
        task("c", { status: "completed" }),
      ],
    };
    expect(stallOf(s, s.runs[0])).toBeUndefined();
    expect(stepOf(s, at(MIN))).toMatchObject({ kind: "retry", due: true });
    expect(
      failedRetriesDue(s, at(MIN), noCoordinator).map((x) => [
        x.task.id,
        x.kind,
      ]),
    ).toEqual([["f", "retry"]]);
  });
});

describe("failedRetryOf: the last failure", () => {
  it("accepts it when its branch has commits beyond its base and its checks pass, with the reason", () => {
    const s = lastTry(
      { checks: [passed()], validateConfigIds: ["cfg_test"] },
      "ddddddd",
    );
    expect(stepOf(s, at(MIN))).toEqual({
      kind: "accept",
      task: s.tasks[0],
      reason:
        "failed 3 of 3 attempts; accepted because it committed its work and its checks pass: tests failed in parser",
    });
    const done = resolveFailedWait(
      s,
      "f",
      "accept",
      new Date(at(MIN)).toISOString(),
      { reason: (stepOf(s, at(MIN)) as { reason: string }).reason },
    );
    expect(done.ok && done.value.completionOverride?.reason).toMatch(
      /^failed 3 of 3 attempts; accepted because/,
    );
    // done once its work is on the plan branch (state.ts doneStatusOf): merged first, from its own worktree
    expect(done.ok && ["completed", "merging"]).toContain(
      done.ok && done.value.status,
    );
  });

  it("accepts a Task with no checks that committed its work", () => {
    expect(stepOf(lastTry({}, "ddddddd"), at(MIN))?.kind).toBe("accept");
  });

  it("escalates when nothing was committed: the last head is its base", () => {
    expect(stepOf(lastTry({}, "aaaaaaa"), at(MIN))).toMatchObject({
      kind: "escalate",
      why: expect.stringContaining("it committed no work"),
    });
  });

  it("escalates when its checks fail, or never checked its last attempt", () => {
    const failing = lastTry(
      {
        checks: [passed({ status: "failed" })],
        validateConfigIds: ["cfg_test"],
      },
      "ddddddd",
    );
    expect(stepOf(failing, at(MIN))).toMatchObject({
      kind: "escalate",
      why: expect.stringContaining("its checks do not pass"),
    });
    const unchecked = lastTry({ validateConfigIds: ["cfg_test"] }, "ddddddd");
    expect(stepOf(unchecked, at(MIN))?.kind).toBe("escalate");
    const stale = lastTry(
      {
        checks: [passed({ endedAt: "2026-10-31T01:40:00.000Z" })],
        validateConfigIds: ["cfg_test"],
      },
      "ddddddd",
    );
    expect(stepOf(stale, at(MIN))?.kind).toBe("escalate");
  });

  it("waits briefly for the last head to be recorded, then escalates", () => {
    const s = lastTry({}, undefined);
    expect(stepOf(s, at(MIN))?.kind).toBe("wait");
    expect(stepOf(s, at(HEAD_WAIT_MS))?.kind).toBe("escalate");
  });

  it("escalates into the owner question the stalled Run already raises", () => {
    const s = lastTry({}, "aaaaaaa");
    const stall = stallOf(s, s.runs[0])!;
    expect(failedWaitQuestion(s, stall.blocks[0], FAILED_AT).options).toEqual([
      ...FAILED_WAIT_OPTIONS,
    ]);
  });
});

describe("committedWork", () => {
  it("reads commits off the Task links, or the recorded range across Windows spellings of one folder", () => {
    expect(
      committedWork(
        state({ links: { commits: ["abc1234"] } }, { dispatches: [] }),
        task("f", { links: { commits: ["abc1234"] } }),
      ),
    ).toBe(true);
    const s = state(
      {},
      {
        dispatches: [
          attempt("f", 1, { cwd: "C:\\WT\\T", git: { base: "aaaaaaa" } }),
          attempt("f", 2, { cwd: "c:/wt/t", git: { head: "bbbbbbb" } }),
        ],
      },
    );
    expect(committedWork(s, s.tasks[0])).toBe(true);
    expect(committedWork(state({}, { dispatches: [] }), task("f"))).toBe(false);
  });

  it("ignores review attempts", () => {
    const s = state(
      {},
      {
        dispatches: [
          attempt("f", 1, { git: { base: "aaaaaaa", head: "aaaaaaa" } }),
          attempt("f", 2, { review: true } as Partial<Dispatch>),
        ],
      },
    );
    expect(committedWork(s, s.tasks[0])).toBe(false);
  });
});

describe("checksPass", () => {
  it("passes with no checks at all, fails with checks configured and none run", () => {
    expect(checksPass(state({}), task("f"))).toBe(true);
    expect(checksPass(state({}), task("f", { validateConfigIds: ["x"] }))).toBe(
      false,
    );
  });
});

describe("failedRetryOf: what stays unchanged", () => {
  it("leaves a plan with a live coordinator, or one that is not hands-off", () => {
    expect(stepOf(state({}), at(MIN), true)).toBeUndefined();
    expect(
      stepOf(state({}, { job: { handsOff: false } }), at(MIN)),
    ).toBeUndefined();
    expect(
      stepOf(lastTry({}, "ddddddd", { job: { handsOff: false } }), at(MIN)),
    ).toBeUndefined();
  });

  it("defers while a replan is under way on the plan", () => {
    const replanning = state(
      {},
      {
        job: {
          replan: undefined,
          plannerSessionIds: ["ses_p"],
          replanning: {
            sessionId: "ses_r",
            startedAt: FAILED_AT,
          } as Job["replanning"],
        },
      },
    );
    expect(stepOf(replanning, at(MIN))).toBeUndefined();
  });

  it("leaves a held or paused plan, a Task with a worker or a Gate on it, and one the owner was asked about", () => {
    expect(
      stepOf(state({}, { job: { dispatchHold: true } }), at(MIN)),
    ).toBeUndefined();
    expect(
      stepOf(state({}, { run: { paused: true } }), at(MIN)),
    ).toBeUndefined();
    const working = state(
      {},
      {
        dispatches: [
          attempt("f", 1),
          attempt("f", 2, { outcome: undefined, endedAt: undefined }),
        ],
      },
    );
    expect(stepOf(working, at(MIN))).toBeUndefined();
    const gated: OrchState = {
      ...state({}),
      gates: [
        {
          id: "g",
          runId: "run_1",
          taskId: "f",
          question: "q",
          status: "open",
          createdAt: FAILED_AT,
        },
      ],
    };
    expect(stepOf(gated, at(MIN))).toBeUndefined();
    const s = lastTry({}, "aaaaaaa");
    const asked: OrchState = {
      ...s,
      messages: [
        failedWaitQuestion(s, stallOf(s, s.runs[0])!.blocks[0], FAILED_AT),
      ],
    };
    expect(stepOf(asked, at(MIN))).toBeUndefined();
  });
});
