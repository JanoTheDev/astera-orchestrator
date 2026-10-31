// T10: a hands-off plan with no coordinator retries its own failed Tasks.
//
// A plan the app places hands-off has no coordinator, and the app's loop starts only `ready` Tasks: a failed one sat
// there until the owner answered the failed-Task question (replan.ts `failedWaitQuestion`). Here Astera decides that
// question itself while it can:
// - `retry`: the Task has tries left (`consecutiveFailures < FAILURE_LIMIT`). It is retried once its backoff is over
//   (`FAILED_RETRY_BACKOFF_MS`: 1 minute after the 1st failure, 5 after the 2nd), keeping its failure count, so the
//   tries run out instead of repeating forever.
// - `accept`: its last try failed, but its branch has commits beyond its base and its latest checks passed (or it has
//   none): it counts as done with a `completionOverride` that says so.
// - `escalate`: otherwise. Today's path: the stalled Run asks the owner (`run-failed-ask`); a failed Task that holds
//   nothing back is left to the owner as before.
// - `wait`: its last try ended moments ago and the Host has not recorded where its branch ended yet, so whether it
//   committed is not known (`HEAD_WAIT_MS`).
//
// Pure, no clock. The backoff itself (`failedRetryAt`) is in replan.ts, where the renderer-safe board (blocked.ts) reads
// it for "retrying in N min".
import { checkConfigIdsOf } from "../convergence";
import { handsOffOf } from "../delivery";
import { failedRetryAt, failedWaitAsked, failedWaitChoice } from "../replan";
import { jobActive } from "../schedule";
import { jobOf, type OrchState } from "../state";
import { FAILURE_LIMIT, type Dispatch, type Task } from "../types";

export { FAILED_RETRY_BACKOFF_MS, failedRetryAt } from "../replan";

/** How long after the last failure the Host's record of where the branch ended is waited for (runGitRecorder.ts reads
 *  an attempt's head once it ends, with its own short retries). Past it, an unrecorded head counts as no commits. */
export const HEAD_WAIT_MS = 2 * 60_000;

export type FailedRetryStep =
  /** `due`: its backoff is over, so it is retried now; `attempt`: the try this retry is (2 or 3 of FAILURE_LIMIT). */
  | {
      kind: "retry";
      task: Task;
      at: string;
      due: boolean;
      attempt: number;
      why: string;
    }
  | { kind: "accept"; task: Task; reason: string }
  | { kind: "escalate"; task: Task; why: string }
  | { kind: "wait"; task: Task; why: string };

const oneLine = (text: string | undefined, max = 300): string =>
  (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Why its last try failed, one line: its worker's report, else its failed checks. */
export const failedWhy = (t: Task): string =>
  oneLine(t.result) || oneLine(t.lastFailure) || "(no report)";

/** One folder, however the Host spelled it: separators, a trailing one, and the case of a Windows path. */
const folderKey = (p: string): string => {
  const k = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(k) || k.startsWith("//") ? k.toLowerCase() : k;
};

/** Whether the Task's branch has commits beyond its base: its links name commits, or its last attempt ended at a head
 *  other than the base its first attempt in that folder started from. Undefined: the last attempt's head is not
 *  recorded yet. False: nothing recorded shows a commit. */
export function committedWork(s: OrchState, t: Task): boolean | undefined {
  if ((t.links?.commits?.length ?? 0) > 0) return true;
  const attempts = s.dispatches
    .filter((d) => d.taskId === t.id && !d.review)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const last = attempts.at(-1);
  if (!last) return false;
  const base = attempts.find(
    (d: Dispatch) =>
      d.git?.base !== undefined && folderKey(d.cwd) === folderKey(last.cwd),
  )?.git?.base;
  if (base === undefined) return false;
  if (last.git?.head === undefined) return undefined;
  return last.git.head !== base;
}

/** Whether the Task's latest checks passed: it has no checks, or every check of its last round passed and that round
 *  checked its last attempt (a round older than that attempt says nothing about its work). */
export function checksPass(s: OrchState, t: Task): boolean {
  if (checkConfigIdsOf(t).length === 0 && (t.checks?.length ?? 0) === 0)
    return true;
  const checks = t.checks ?? [];
  if (checks.length === 0 || !checks.every((c) => c.status === "passed"))
    return false;
  const lastStart = s.dispatches
    .filter((d) => d.taskId === t.id && !d.review)
    .map((d) => d.startedAt)
    .sort()
    .at(-1);
  return (
    lastStart === undefined ||
    checks.every(
      (c) =>
        (c.endedAt ?? c.startedAt) === undefined ||
        (c.endedAt ?? c.startedAt)! >= lastStart,
    )
  );
}

/**
 * What Astera does about failed Task `t` now, or undefined when it is not Astera's to decide: not failed, not a live
 * hands-off plan (active, not held, the Run not paused), a coordinator is alive or starting (`coordinatorLive`, the
 * dispatch loop's), a replan is under way (it looks at the failure first), a worker or a Gate is on it, or the owner was
 * already asked about this failure (their answer is carried out by `unstallRuns`).
 */
export function failedRetryOf(
  s: OrchState,
  t: Task,
  a: { coordinatorLive: boolean; nowMs: number },
): FailedRetryStep | undefined {
  if (t.status !== "failed" || a.coordinatorLive) return undefined;
  const run =
    t.runId === undefined ? undefined : s.runs.find((r) => r.id === t.runId);
  const job = run && jobOf(s, run);
  if (
    !run ||
    !job ||
    !handsOffOf(s, job) ||
    !jobActive(job) ||
    job.dispatchHold ||
    job.replanning ||
    run.paused
  )
    return undefined;
  if (s.dispatches.some((d) => d.taskId === t.id && !d.outcome && !d.endedAt))
    return undefined;
  if (s.gates.some((g) => g.taskId === t.id && g.status === "open"))
    return undefined;
  if (failedWaitAsked(s, t) || failedWaitChoice(s, t) !== undefined)
    return undefined;
  const why = failedWhy(t);
  const at = failedRetryAt(t);
  if (at !== undefined) {
    const attempt = Math.max(t.consecutiveFailures, 1) + 1;
    return {
      kind: "retry",
      task: t,
      at,
      due: Date.parse(at) <= a.nowMs,
      attempt,
      why,
    };
  }
  const committed = committedWork(s, t);
  if (
    committed === undefined &&
    a.nowMs - Date.parse(t.updatedAt) < HEAD_WAIT_MS
  )
    return {
      kind: "wait",
      task: t,
      why: "its last attempt just ended; where its branch ended is not recorded yet",
    };
  const passed = checksPass(s, t);
  if (committed === true && passed)
    return {
      kind: "accept",
      task: t,
      reason: `failed ${t.consecutiveFailures} of ${FAILURE_LIMIT} attempts; accepted because it committed its work and its checks pass: ${why}`,
    };
  return {
    kind: "escalate",
    task: t,
    why: `failed ${t.consecutiveFailures} of ${FAILURE_LIMIT} attempts; ${committed === true ? "its checks do not pass" : "it committed no work"}: ${why}`,
  };
}

/** Every failed Task Astera decides about now, over all Runs. `coordinatorLive` is the dispatch loop's: a coordinator
 *  alive or starting for the Run. */
export function failedRetriesDue(
  s: OrchState,
  nowMs: number,
  coordinatorLive: (runId: string) => boolean,
): FailedRetryStep[] {
  return s.tasks.flatMap((t) => {
    if (t.status !== "failed" || t.runId === undefined) return [];
    const step = failedRetryOf(s, t, {
      coordinatorLive: coordinatorLive(t.runId),
      nowMs,
    });
    return step ? [step] : [];
  });
}
