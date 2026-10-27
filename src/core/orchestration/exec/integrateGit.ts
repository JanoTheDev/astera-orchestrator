// The worktree git of orchestration: forking a worktree off the branch a project stands on, and
// merging finished worktrees back into a folder. Moved out of the app's bootOrch closures so that the
// Host can run the same git (S3): every check, every command and every rollback below is the one the
// app ran, in the same order. What differs between the two processes is injected: where the log goes,
// who is told Astera is about to move HEAD, and how a merged worktree is removed.
//
// This module must stay importable by the Host: no electron, nothing from src/main.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { OrchServerDeps } from '../command'
import { t, type Message, type MessageKey, type MessageParams } from '../../i18n'
import { isSamePath } from '../../files/tree'
import { createWorktree } from '../../worktrees/create'
import { workerBaseFailure } from '../../worktrees/base'
import { git as realGit, gitDir, gitVersionAtLeast, listGitWorktrees, fetchOrigin, GIT_WRITE_TIMEOUT_MS } from '../../worktrees/git'
import { backupRef, removeWorktree } from '../../worktrees/remove'
import { LOCKFILES, runWorktreeSetup } from '../../worktrees/setup'
import { askUntilAnswered, defaultActionPresenceCheck, type CheckResult, type PresenceCheck } from '../../worktrees/presence'
import type { WorktreeStore } from '../../worktrees/registry'
import { defaultGateProbe, type Probe } from '../../sessions/pathProbe'
// W8-A commit attribution
import { ensureNotesConfig, pushNotes, trailersOfRef, withTrailers } from '../../attribution/note'

/** 프로젝트 폴더가 **서 있는 브랜치**에서 워크트리를 하나 만들고 그 경로를 낸다.
 *
 *  워커의 워크트리도 Run 의 워크트리도 프로젝트가 서 있는 브랜치에서 갈라져야 한다.
 *  createWorktree 의 자동 판정(origin/HEAD → main → master, core/worktrees/git.ts 의
 *  detectBaseRef)에 맡기면 프로젝트의 기본 브랜치에서 갈라지고 — Run 이 서 있는 브랜치와 다른
 *  조상이다 — 병합 단계가 무의미해진다: 의존의 워크트리를 이 뿌리로 접어 넣은 뒤 Task 를
 *  시작하는데, origin/HEAD 에서 갈라진 워커에게는 그 히스토리가 애초에 조상이 아니어서 병합
 *  때문에 보이는 것이 하나도 바뀌지 않는다.
 *
 *  문자열 'HEAD' 를 그대로 넘길 수 없다: baseRef 는 toFullRef 를 지나는데 슬래시 없는 이름을
 *  refs/heads/<name> 으로만 푼다 — 'HEAD' 는 refs/heads/HEAD 를 찾아 없으므로 NO_BASE 로
 *  던진다. 그래서 브랜치의 짧은 이름을 먼저 읽는다.
 *
 *  `rev-parse --abbrev-ref HEAD` 가 아니라 `symbolic-ref --quiet --short HEAD` 를 쓴다:
 *  전자는 분리된 HEAD 에서 실패하지 않고 리터럴 'HEAD' 를 돌려주므로, 그 값을 믿는 호출자는
 *  존재하지 않는 'HEAD' 라는 브랜치에서 갈라지려 한다. symbolic-ref 는 분리된 HEAD 에서
 *  그냥 실패하고, 그 실패가 정확히 여기 필요한 신호다. 이 저장소의 다른 두 곳도 같은 질문을
 *  같은 방식으로 묻는다(integrateWorktrees 의 병합 전 확인, git.ts 의 listBranches).
 *
 *  **저장소에 닿는지를 먼저 묻는다.** symbolic-ref 는 유효한 저장소에서만 "분리됐는가" 를
 *  답한다 — 그 경로에서 git 을 돌릴 수 없을 때도 똑같이 실패하므로, 그 실패를 곧 분리로 읽던
 *  동안 앱은 폴더가 사라진 Run 에도 "HEAD 가 분리됐다"고 말했다. 어느 쪽인지 가르는 것은
 *  core 의 workerBaseFailure 이고 문장도 그쪽에 있다.
 *
 *  **자동 판정으로 조용히 물러나지 않고 던진다.** 물러나면 이 확인이 막으려던 버그가 그대로
 *  되살아나고, 워커는 나중에 아무 데도 합칠 수 없는 일을 하게 된다 — 워커 세션 하나를 통째로
 *  태운 뒤에야 문제가 보인다. 여기서 던지면 시작 시점에 보고된다.
 *
 *  toFullRef 의 해석 순서에 남은 위험(브랜치 이름의 첫 조각이 원격 이름과 같을 때 원격 추적
 *  사본에서 갈라진다)은 그대로다 — 이 저장소의 원격은 origin 하나이고 어느 지역 브랜치의 첫
 *  조각도 그것과 다르다. 그 판단의 전문은 이 헬퍼를 뽑아 온 자리(git.ts 의 fetchBaseRef 주석)에
 *  있다. */
export async function forkWorktree(
  a: {
    repoPath: string
    name?: string
    /** The folder whose checked-out branch to fork from, when it is not repoPath's own (W5-A, #50): a
     *  dependent Task forks from its Run's worktree, where its finished deps were merged. Default repoPath. */
    baseOf?: string
    /** The plan's target branch (`deliveryBranchOf`) to fork from instead of the branch the folder stands on: the local
     *  branch, or `origin/<base>` when origin is ahead of it or it is only on origin. Callers never pass it with baseOf. */
    base?: string
  },
  ctx: {
    registry: WorktreeStore
    log(m: string): void
    /** Test seam: the probe the project folder is asked through before git is spawned in it. */
    probe?: Probe
    /** The project's `setupCommand` (absent: detect from the lockfile, `off`: none), run in the new worktree. */
    setupCommand?: string
  }
): Promise<string> {
  // **폴더를 git 보다 먼저 묻는다** (예산 안의 세션 폴더 probe). 끊긴 공유 위의 폴더를 cwd 로
  // git 을 띄우면 Windows 는 그 폴더를 부르는 스레드 — Host 의 하나뿐인 스레드 — 에서 동기로
  // 들여다보고, 그동안 그 스레드가 쥔 모든 pty 가 멈춘다. 답이 없으면 "닿지 않는다"이지 "저장소가
  // 사라졌다"(NO_REPO)가 아니다.
  // **상한을 넘어서 묻는다**(defaultGateProbe) — createWorktree 가 같은 폴더를 묻는 방식과 같다. 사람이
  // 워커의 워크트리를 기다리고 있으므로, 다른 곳의 죽은 드라이브가 살아 있는 로컬 저장소를 막으면
  // 안 된다(stage 4 최종 리뷰). 그 폴더 자신이 멎어 있으면 여전히 거절된다.
  const at = await (ctx.probe ?? defaultGateProbe)(a.repoPath)
  if (at === 'timeout') throw new Error(`REPO_UNREACHABLE: folder not reachable: ${a.repoPath}`)
  if (at === 'absent')
    throw new Error(workerBaseFailure({ repoPath: a.repoPath, repoReachable: false, onBranch: false, stderr: 'the folder is not there' }) ?? '')
  const baseDir = a.baseOf ?? a.repoPath
  const gitDirProbe = await realGit(['rev-parse', '--git-dir'], { cwd: baseDir })
  const head = !gitDirProbe.ok
    ? { ok: false, stdout: '', stderr: '' }
    : a.base !== undefined
      ? { ok: true, stdout: a.base, stderr: '' }
      : await realGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: baseDir })
  const baseFailure = workerBaseFailure({
    repoPath: baseDir,
    repoReachable: gitDirProbe.ok,
    onBranch: head.ok,
    stderr: gitDirProbe.stderr || gitDirProbe.stdout
  })
  if (baseFailure !== null) throw new Error(baseFailure)
  // T4: a fork off the project folder starts from origin's commit when teammates pushed since the folder last pulled
  const ahead = a.baseOf === undefined ? await originAhead(a.repoPath, head.stdout, ctx.log) : false
  // A target branch only on origin (fetched just above) forks from origin's copy; createWorktree says NO_BASE for neither
  const onlyOnOrigin = a.base !== undefined && !(await realGit(['rev-parse', '--verify', '--quiet', `refs/heads/${a.base}`], { cwd: a.repoPath })).ok
  const r = await createWorktree({
    repoPath: a.repoPath,
    name: a.name,
    baseRef: onlyOnOrigin ? `origin/${head.stdout}` : head.stdout,
    registry: ctx.registry,
    ...(ctx.probe ? { repoProbe: ctx.probe } : {})
  })
  // 경고를 버리지 않는다 — worktree.create.fetchFailed 는 "base 를 가져올 수 없어 낡은 참조에서
  // 만들었다" 는 뜻이고 워커는 그 위에서 일한다. 이 경로에는 사용자 화면이 없어 로그가 유일한
  // 흔적이다. 키만 남긴다: 번역은 렌더러의 일이고 여기에는 언어가 없다.
  for (const w of r.warnings) ctx.log(`worktree warning ${w.key} ${JSON.stringify(w.params ?? {})}`)
  // The new branch moves, never the owner's checked-out one; the base recorded stays the local name (a PR's base)
  if (ahead) {
    const ff = await realGit(['merge', '--ff-only', `refs/remotes/origin/${head.stdout}`], { cwd: r.info.path, timeoutMs: GIT_WRITE_TIMEOUT_MS })
    ctx.log(
      ff.ok
        ? `fork: ${r.info.path} starts at origin/${head.stdout}, which is ahead of the local ${head.stdout}`
        : `fork: ${r.info.path} could not fast-forward to origin/${head.stdout}, so it starts at the local ${head.stdout}: ${ff.stderr}`
    )
  }
  // Fresh checkouts have no node_modules, which a pre-push hook that needs its tools rejects; never fails the fork
  await runWorktreeSetup({ dir: r.info.path, setting: ctx.setupCommand, log: ctx.log })
  return r.info.path
}

/** T4: fetches origin's `branch` before a fork and says whether `origin/<branch>` is ahead of the local branch, which
 *  fast-forwards to it (so the fork may start there). No origin or no answer is logged and reads false: the fork goes on. */
async function originAhead(repo: string, branch: string, log: (m: string) => void): Promise<boolean> {
  const f = await fetchOrigin(repo, branch)
  if (f.kind === 'no-origin' || f.kind === 'no-repo') return false
  if (f.kind === 'failed') {
    log(`fork: origin ${branch} could not be fetched (offline?), so the fork starts at the local ${branch}: ${f.reason}`)
    return false
  }
  const [local, remote] = await Promise.all([
    realGit(['rev-parse', `refs/heads/${branch}`], { cwd: repo }),
    realGit(['rev-parse', `refs/remotes/origin/${branch}`], { cwd: repo })
  ])
  if (!local.ok || !remote.ok || local.stdout === remote.stdout) return false
  return (await realGit(['merge-base', '--is-ancestor', local.stdout, remote.stdout], { cwd: repo })).ok
}

/** The identity a merge commit falls back to when git has none here (W5-A, #51). */
export const FALLBACK_GIT_IDENTITY = { name: 'Astera', email: 'astera@localhost' } as const

/** `-c` arguments that give a merge commit an identity when git has none in `cwd` (W5-A, #51): on a machine
 *  with no `user.name`/`user.email` the merge failed with "Committer identity unknown" and the plan's PR was
 *  never opened. Only the missing key is supplied, so a person's own name or email always wins, and only
 *  for this one command: no git config is written, global or local. Empty when git already has one. */
export async function mergeIdentityArgs(cwd: string, run: typeof realGit = realGit): Promise<string[]> {
  if ((await run(['var', 'GIT_COMMITTER_IDENT'], { cwd })).ok) return []
  const out: string[] = []
  if (!(await run(['config', 'user.name'], { cwd })).stdout) out.push('-c', `user.name=${FALLBACK_GIT_IDENTITY.name}`)
  if (!(await run(['config', 'user.email'], { cwd })).stdout) out.push('-c', `user.email=${FALLBACK_GIT_IDENTITY.email}`)
  return out
}

/** Merges each dependency's worktree branch into a worktree just forked for its dependent Task (W5-A, #50),
 *  in deps order, so the worker starts with its dependencies' commits. A coordinator places Tasks itself and
 *  nothing merges its deps into the Run's worktree first; the app's scheduler does (integrateWorktrees), and
 *  then the dep folder may already be reaped: its commits are in the base the fork came from, so a folder
 *  git cannot read is skipped. A failed merge is aborted and thrown, so the start fails and the caller
 *  removes the fresh fork (the Host's discardFork); nothing of the user's checkout is touched here. */
export async function mergeDepsInto(
  worktree: string,
  from: string[],
  ctx: { log(m: string): void; git?: typeof realGit }
): Promise<void> {
  const run = ctx.git ?? realGit
  const ident = from.length > 0 ? await mergeIdentityArgs(worktree, run) : []
  for (const dep of from) {
    const sha = await run(['rev-parse', '--verify', 'HEAD'], { cwd: dep })
    if (!sha.ok) {
      ctx.log(`worker-start: dependency worktree ${dep} is not readable, so not merged (its work is in the base, or gone)`)
      continue
    }
    // The branch name, when there is one, makes the merge commit say which Task it brought in.
    const branch = await run(['symbolic-ref', '--quiet', 'HEAD'], { cwd: dep })
    const ref = branch.ok && branch.stdout !== '' ? branch.stdout : sha.stdout
    // W8-A: a merge commit Astera writes carries the Wave 8 trailers of the work it brings in
    const merged = await run([...ident, 'merge', ...(await attributedMergeArgs(worktree, ref, undefined, run))], {
      cwd: worktree,
      timeoutMs: GIT_WRITE_TIMEOUT_MS
    })
    if (!merged.ok) {
      await run(['merge', '--abort'], { cwd: worktree, timeoutMs: GIT_WRITE_TIMEOUT_MS })
      throw new Error(`DEP_MERGE: could not merge the dependency worktree ${dep} into ${worktree}: ${merged.stderr || merged.stdout}`)
    }
    ctx.log(`worker-start: merged ${ref} from ${dep} into ${worktree}`)
  }
}

/** W8-A: the arguments after `merge` for merging `ref` (the ref last): `message` with the Wave 8 trailers of the work
 *  `ref` brings in (`trailersOfRef`), with `--no-ff` so a delivery always writes its commit; without a message, git's
 *  own merge message, plus the trailers when there are any. */
async function attributedMergeArgs(cwd: string, ref: string, message: string | undefined, run: typeof realGit): Promise<string[]> {
  const trailers = await trailersOfRef(cwd, ref, run)
  if (message !== undefined) return ['--no-ff', '-m', withTrailers(message, trailers), ref]
  if (trailers.length === 0) return ['--no-edit', ref]
  const name = ref.startsWith('refs/heads/') ? `branch '${ref.slice('refs/heads/'.length)}'` : `commit '${ref}'`
  return ['--no-edit', '-m', withTrailers(`Merge ${name}`, trailers), ref]
}

/** One untracked file set aside so a merge can run (`setAsideUntracked`). */
interface Aside {
  path: string
  aside: string
  link: boolean
}

/** The untracked files a merge's refusal names ("would be overwritten by merge"), moved aside, when each is one git
 *  ignores or a symlink named node_modules; null when there are none, or one is anything else (that one is the
 *  owner's, and the merge's refusal stands). */
export async function setAsideUntracked(cwd: string, stderr: string, run: typeof realGit = realGit): Promise<Aside[] | null> {
  const m = /untracked working tree files would be overwritten by merge:\n([\s\S]*?)\n(?:Please|Aborting)/.exec(stderr)
  if (!m) return null
  const files = m[1].split('\n').map((l) => l.trim()).filter((l) => l !== '')
  if (files.length === 0) return null
  const out: Aside[] = []
  for (const f of files) {
    const abs = path.join(cwd, f)
    const link = await fs.lstat(abs).then((st) => st.isSymbolicLink(), () => false)
    const ignored = (await run(['check-ignore', '-q', '--', f], { cwd })).ok
    if (!ignored && !(link && path.basename(f) === 'node_modules')) return null
    out.push({ path: abs, aside: `${abs}.astera-aside-${process.pid}-${Date.now()}`, link })
  }
  for (const a of out) await fs.rename(a.path, a.aside)
  return out
}

/** Puts set-aside files back. One the merge brought in its place stays the merge's: a link set aside is dropped (it
 *  held nothing), any other file is kept beside it under its aside name and logged, so nothing is lost. */
async function restoreAside(aside: Aside[], log: (m: string) => void): Promise<void> {
  for (const a of aside) {
    try {
      const taken = await fs.lstat(a.path).then(() => true, () => false)
      if (!taken) await fs.rename(a.aside, a.path)
      else if (a.link) await fs.unlink(a.aside)
      else log(`merge: the merge brought ${a.path}; the untracked file that was there is kept at ${a.aside}`)
    } catch (e) {
      log(`merge: could not put ${a.path} back from ${a.aside}: ${String(e)}`)
    }
  }
}

/** 통합의 결과. 셋뿐이다 — 합쳤다, 사람에게 가야 한다, 에이전트에게 넘겨야 한다. */
export type Integration =
  /** uncommitted: 합친 워크트리들에 **커밋되지 않은 채 남은** 변경의 수. git 은 커밋만 옮기므로
   *  그 변경은 병합되지 않았고 그 폴더에만 있다 — 폴더를 지우면 사라진다. 워커에게 커밋 의무를
   *  주기는 하지만(coordinator 의 commitObligation) 지켰는지 확인하는 곳은 없어서, 이 수가
   *  사람에게 그 사실이 닿는 유일한 자리다. */
  | {
      kind: 'merged'
      uncommitted: number
      /** Source worktrees whose `git status` could not be read (error, timeout, output limit). Their
       *  uncommitted changes are **unknown**, not 0 — so the person is told "could not check" for
       *  them rather than nothing. Absent when every status was read. */
      unchecked?: string[]
      /** Source worktrees that hold uncommitted changes (the ones `uncommitted` counts). A caller about
       *  to delete folders keeps these: the changes live only there. Absent when there are none. */
      dirty?: string[]
    }
  /** `reason` is English (logs, `run-merge`, a merge worker's spec); `message`, when set, is the same sentence for the
   *  owner's Gate, rendered in the app's language by the caller (dispatchLoop.ts). */
  | { kind: 'human'; reason: string; message?: Message }
  | { kind: 'agent'; reason: string; worktrees: { path: string; branch: string | null }[] }

export interface IntegrateContext {
  log(m: string): void
  /** Who is told Astera is moving HEAD (EG §26): in the app, its own collector, or the Host's through
   *  `work-units-git-op` in front of a Host that writes work units (appWorkUnits); `git-op` in the Host (R7). */
  /** Either may be async (R24): the Host's begin writes the merge record before it answers, and the
   *  merge waits for it. A rejecting end is logged; it never costs the merge. */
  gitOp: { begin(kind: 'job-merge', cwd: string): string | Promise<string>; end(id: string): void | Promise<void> }
  /** Removes one merged worktree; never throws (reapWorktree). */
  reap(worktreePath: string): Promise<boolean>
  /** Test seams for rules 6 and 8 of the design's §3.2: an old git and the merge's argv cannot be
   *  produced by a real repository. Default to the real ones. */
  git?: typeof realGit
  gitAtLeast?: typeof gitVersionAtLeast
  /** Whether a marker file is in the git dir, asked asynchronously with a time limit. Test seam;
   *  defaults to the process-wide action-lane check (worktrees/presence.ts): one call per root, so a
   *  check stuck on another drive never refuses this one. */
  presence?: PresenceCheck
}

/** A result only a person can settle: English `reason`, the owner's own language through `message`. */
const human = (key: MessageKey, params: MessageParams): Integration => ({
  kind: 'human',
  reason: t('en', key, params),
  message: { key, params }
})

/** 워크트리에서 끝난 일을 **합칠 폴더에 실제로 합친다.** 그 폴더는 부르는 쪽이 정한다 —
 *  스케줄러는 Run 뿌리를 주고 `run-delete --merge` 는 프로젝트 폴더를 준다. 무엇을 합쳐야
 *  하는가의 판정은 integrate.ts 가 하고(순수하므로 테스트가 있다), 이 함수는 그 답을 git 으로
 *  실행한다.
 *
 *  **이것이 사용자의 저장소에 스스로 쓰는 유일한 자동 경로다.** 사용자가 그렇게 결정했으므로
 *  허용되지만, 지켜야 하는 것이 하나 있다: **어떤 실패 경로에서도 합칠 폴더를 병합 중간
 *  상태로 남기지 않는다.** 아래의 순서(미리 검사 → 진짜 병합 → 실패하면 되돌리고 되돌아갔는지
 *  확인)가 전부 그것을 위한 것이다. */
/**
 * 워크트리 브랜치들을 `mergeInto` 에 합친다.
 *
 * **`reap` 이 두 호출자를 가른다.** 기본값이 참인 것은 스케줄러의 통합 병합이다 — 그 워크트리는
 * 끝난 의존의 것이고 방금 접어 넣었으므로 다시 쓸 사람이 없다. 회차마다 워커 수만큼 폴더가
 * 쌓이는 것을 막는 것이 그 자동 정리의 이유다(스물일곱 개까지 갔다).
 *
 * `reap: false` 로 부르는 것은 사람이 누르는 병합(`run-merge`)과 `run-delete --merge` 다. 폴더를
 * 지우는 것은 그 사람의 몫이다 — 삭제 모달에는 그 체크박스가 따로 있고, 사람은 결과를 보고 다시
 * 합칠 수도 있다. 여기서 걷으면 `run.worktree` 가 사라진 폴더를 가리킨 채 남고(setRunWorktree 는
 * 두 번째 쓰기를 거절한다) 배치가 그 경로를 fs.stat 하므로, **그 Run 은 다시는 Task 를 띄울 수
 * 없다.**
 */
export async function integrateWorktrees(
  mergeInto: string,
  paths: string[],
  opts: { reap?: boolean; message?: string; heads?: Record<string, string> },
  ctx: IntegrateContext
): Promise<Integration> {
  const reap = opts.reap ?? true
  // 1. **저장소가 무언가의 중간이면 아무것도 하지 않는다.** 아래 2의 porcelain 검사는 경로 항목만
  //    내므로 브랜치·상태를 전혀 말하지 않는다 — 작업 트리가 깨끗한 채로 rebase·bisect 중인
  //    저장소와 분리된 HEAD 는 **빈 출력을 낸다.** 그것을 안전으로 읽으면 앱이 그 위에 병합을 건다.
  //
  //    **git 이 막아 주지 않는다.** 임시 저장소에서 실측한 것이다(아래의 거절들은 이제 옆의
  //    integrateGit.test.ts 가 표시 파일마다 임시 저장소로 고정한다):
  //    bisect 중에도, `rebase -i` 가 break 에서 멈춘 상태에서도 `git merge` 는 **성공한다**
  //    (exit 0, "Merge made by the 'ort' strategy"). 그 병합 커밋은 분리된 HEAD 위에 생기고 앱은
  //    "합쳤다"고 보고한다. 사용자가 브랜치를 체크아웃하거나 `rebase --continue|--abort` 를 하는
  //    순간 그 커밋은 도달 불가가 되고, bisect·rebase 세션은 깨진다. 일 자체는 워크트리 브랜치에
  //    남으므로 영구 손실은 아니지만, **사용자의 저장소를 이상한 상태로 두지 않는다**는 이 함수의
  //    규칙에 정면으로 걸린다.
  //
  //    두 가지를 함께 묻는다. 하나로는 못 덮기 때문이다.
  //    - **분리된 HEAD 는 `symbolic-ref --quiet HEAD` 의 실패**로 본다(listBranches 가 이미 그렇게
  //      묻는다). 이것 하나가 bisect·rebase(대화형이든 아니든 HEAD 를 분리한다)·순수 분리 HEAD 를
  //      함께 덮는다. `status --porcelain=v2 --branch` 의 헤더로도 분리는 알 수 있지만 그 헤더는
  //      rebase·bisect·cherry-pick 을 전혀 알려주지 않아 어차피 두 번째 질문이 필요하다.
  //    - **HEAD 를 분리하지 않는 진행 중 작업은 git 디렉터리의 표시 파일**로 본다. cherry-pick·
  //      revert·am·병합은 브랜치 위에 머무르므로 위의 질문에 걸리지 않고, 그 대부분은 충돌이나
  //      staged 변경을 남겨 2가 잡지만 전부는 아니다 — 빈 커밋에서 멈춘 cherry-pick 은 작업
  //      트리가 깨끗한 채 CHERRY_PICK_HEAD 만 남는다. git 자신도 wt_status_get_state 에서 같은
  //      파일들을 본다.
  //
  //    표시 파일의 자리를 `<mergeInto>/.git` 으로 짐작하지 않는다 — 워크트리에서 `.git` 은 파일이고
  //    실제 디렉터리는 <주 저장소>/.git/worktrees/<이름> 이다. 그리고 이 상태들은 워크트리마다
  //    따로다. gitDir()(worktrees/git.ts)이 `--absolute-git-dir` 로 그 자리를 답한다.
  // **git 디렉터리를 먼저 묻는다.** 아래 symbolic-ref 의 실패는 유효한 저장소에서만 "분리됐다"를
  // 뜻하고, 폴더가 사라졌거나 저장소가 아닐 때도 똑같이 실패한다 — 순서가 반대였을 때 이 함수는
  // 그 경우에도 "분리된 HEAD" 라고 말했다. 그 오진이 createWorktree 어댑터 쪽에서 실제로 사람을
  // 헤매게 했고(그쪽 주석), 같은 질문을 같은 방식으로 묻는 이 자리도 같은 순서여야 한다.
  const dir = await gitDir(mergeInto)
  if (!dir)
    return human('jobs.integration.noGit', { folder: mergeInto })
  const head = await (ctx.git ?? realGit)(['symbolic-ref', '--quiet', 'HEAD'], { cwd: mergeInto })
  if (!head.ok)
    return human('jobs.integration.detachedHead', { folder: mergeInto })
  // 표시 파일과 사람에게 보일 이름. rebase-apply 는 `git am` 도 쓴다.
  //
  // **표시 파일은 비동기로, 시간 제한을 두고 묻는다**(worktrees/presence.ts). 동기 existsSync 는 끊긴
  // 네트워크 공유 위의 git 디렉터리에서 스레드를 20~60초 세웠다. 있는지 모르는 표시 파일은 없는 것으로
  // 읽지 않는다 — 진행 중인 작업 위에 병합을 거는 것이 이 확인이 막으려는 바로 그것이다.
  const markers = [
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase or am'],
    ['BISECT_LOG', 'bisect'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['MERGE_HEAD', 'merge']
  ] as const
  let busy: (typeof markers)[number] | undefined
  for (const m of markers) {
    // A refusal (no call made) is asked again (askUntilAnswered). On the action lane it only lasts
    // while this same drive has a call that gave no answer, and then git itself is not answering here.
    const at = await askUntilAnswered(ctx.presence ?? defaultActionPresenceCheck, path.join(dir, m[0]))
    if (at === 'missing') continue
    if (at === 'present') {
      busy = m
      break
    }
    return human('jobs.integration.gitDirUnreachable', { dir, marker: m[0] })
  }
  if (busy)
    return human('jobs.integration.inProgress', { op: busy[1], marker: busy[0] })

  // 2. **추적되는 변경이 남아 있으면 아무것도 하지 않는다.** 병합은 작업 트리에 쓰므로, 그 위에
  //    사용자가 저장하지 않은 일이 있으면 그것을 위험에 놓는다. 그 일을 어떻게 할지는 사람의
  //    판단이고 에이전트가 대신 정할 것이 아니므로 Gate 다("돌릴 수 없을 때만 Gate" 규칙 그대로다).
  //
  //    **isCleanWorktree(worktrees/git.ts)를 쓰지 않는다.** 그쪽은 `--untracked-files=all` 이라
  //    추적되지 않는 파일 하나만 있어도 dirty 라고 답한다 — 그 함수가 답하는 질문은 "이 워크트리를
  //    지워도 되는가"이고 거기서는 그것이 맞다. 여기서 그것을 쓰면 스크린샷 하나 남은 저장소(그것이
  //    보통의 저장소다)에서 자동 Run 이 늘 서 버린다. 추적되지 않는 파일을 통과시켜도 안전한
  //    이유는 git 이 그것을 스스로 지키기 때문이다: 병합이 그 파일을 덮어써야 하면 작업 트리를
  //    **건드리기 전에** 거절한다("untracked working tree files would be overwritten").
  //
  //    `git diff --quiet HEAD` 가 아니라 porcelain 을 읽는 이유는 실패를 구별할 수 있어서다 —
  //    diff 는 "차이가 있다"와 "명령이 실패했다"를 둘 다 0 이 아닌 종료 코드로 내고 git() 은 ok
  //    하나만 준다. 그러면 Gate 의 문장이 사실을 말할 수 없다.
  const status = await (ctx.git ?? realGit)(['status', '--porcelain', '--untracked-files=no'], { cwd: mergeInto })
  if (!status.ok)
    return human('jobs.integration.statusUnreadable', { folder: mergeInto, error: status.stderr })
  if (status.stdout !== '')
    return human('jobs.integration.uncommitted', { count: status.stdout.split('\n').length })

  // 3. 각 워크트리의 브랜치를 알아낸다. `git worktree list` 한 번으로 경로 → 브랜치가 전부 나온다.
  //    listGitWorktrees 는 git() 과 달리 **실패하면 던진다** — 그래서 감싼다.
  let rows: { path: string; branch: string | null }[]
  try {
    rows = await listGitWorktrees(mergeInto)
  } catch (e) {
    return human('jobs.integration.worktreeListUnreadable', { error: String(e) })
  }
  // 경로 비교는 isSamePath 다 — 한쪽은 createWorktree 가 만들어 Dispatch 에 저장된 값이고 다른
  // 쪽은 git 이 방금 낸 값이라 대소문자나 구분자가 다를 수 있다(둘 다 절대경로이므로 결정적이다).
  const found = paths.map((p) => ({
    path: p,
    branch: rows.find((r) => isSamePath(r.path, p))?.branch ?? null
  }))
  // A worktree gone with no branch to name was usually removed after its branch merged. The head the Dispatch recorded
  // says so: when it is already in HEAD there is nothing to merge, and no Gate (a Gate here came back every pass).
  const targets: typeof found = []
  for (const x of found) {
    const head = opts.heads?.[x.path]
    if (!x.branch && head && (await (ctx.git ?? realGit)(['merge-base', '--is-ancestor', head, 'HEAD'], { cwd: mergeInto })).ok) {
      ctx.log(`merge: ${x.path} has no branch, but its recorded head ${head} is already in ${mergeInto}`)
      continue
    }
    targets.push(x)
  }
  if (targets.length === 0) return { kind: 'merged', uncommitted: 0 }
  const unknown = targets.filter((x) => !x.branch)
  if (unknown.length > 0)
    return {
      kind: 'agent',
      // 워크트리가 지워졌거나 HEAD 가 분리된 경우다. 합칠 ref 의 이름을 모르므로 앱은 여기서
      // 할 수 있는 것이 없다 — 그렇다고 없는 것으로 치면 그 의존의 일이 없는 채로 다음 Task 가
      // 뜨고, 그것은 조용히 틀린 결과다.
      reason: `the app could not work out which branch belongs to ${unknown
        .map((x) => x.path)
        .join(', ')} — the worktree may have been removed, or its HEAD may be detached`,
      worktrees: targets
    }

  // 4. merge-tree 가 없으면 **미리 검사할 수 없다.** 검사하지 못하는 것을 낙관하지 않는다 —
  //    낙관해서 진짜 병합을 걸면 충돌할 때 `git merge --abort` 로 되돌려야 하고, 그 되돌리기까지
  //    실패하면 사용자의 저장소가 충돌 상태로 남는다. 그래서 곧바로 에이전트에게 넘긴다.
  if (!(await (ctx.gitAtLeast ?? gitVersionAtLeast)(2, 38)))
    return {
      kind: 'agent',
      reason:
        'this git is older than 2.38, so the app has no way to test a merge without writing to the working tree',
      worktrees: targets
    }

  // 5. 하나씩 **미리 검사한 바로 뒤에 합친다.** 전부 검사하고 전부 합치는 순서가 아닌 이유는
  //    merge-tree 의 기준이 그때의 HEAD 라는 것이다 — 첫 병합이 커밋을 만들면 HEAD 가 움직이고,
  //    그 앞에서 통과했던 두 번째 검사는 낡은 사실이 된다(첫 병합이 가져온 변경 때문에 충돌할 수
  //    있다). 그러면 진짜 병합이 실패하고, 되돌리기에 기대는 바로 그 경로로 들어간다.
  //
  //    검사는 `merge-tree --write-tree` 의 **종료 코드**로 읽는다. remove.ts 의 isBranchMerged 는
  //    같은 명령의 결과 트리를 대상의 트리와 견주지만 그것은 다른 질문("이미 합쳐졌는가", squash
  //    병합 판정)에 답하는 것이다. 여기서 필요한 것은 "충돌하는가"이고 그것이 곧 종료 코드다.
  //
  //    병합 대상은 `HEAD` 다. mergeTarget()(remove.ts)을 쓰지 않는 이유는 그 함수가
  //    branch.<b>.base → origin/HEAD 를 고를 수 있어서다 — 원격 ref 에 합치는 것은 다른 일이다.
  //    이름(`rev-parse --abbrev-ref HEAD`)을 따로 얻지 않는 이유는 **1에서 HEAD 가 브랜치를
  //    가리킴을 이미 보장했으므로** 여기서 `HEAD` 가 곧 "사용자가 지금 서 있는 로컬 브랜치"이고,
  //    그 이름을 다시 문자열로 받아 오면 같은 이름의 태그와 헷갈릴 여지만 생기기 때문이다
  //    (`rev-parse --abbrev-ref HEAD` 는 분리된 HEAD 에서 브랜치 이름이 아니라 `HEAD` 를
  //    돌려주므로, 1의 검사가 없다면 그 문자열을 대상으로 삼는 것 자체가 결함이 된다).
  // 커밋되지 않고 남은 변경의 수. **합치기 전에 센다** — 병합은 대상 폴더를 바꾸지만 원본
  // 워크트리는 건드리지 않으므로 값은 같지만, 세는 시점이 앞이면 병합이 중간에 실패해도 이미
  // 얻은 사실이 남는다.
  //
  // `--porcelain` 의 기본값을 쓴다: 추적되지 않는 파일도 센다. 워커가 새 파일을 만들고 add 하지
  // 않은 것이 정확히 이 경고가 잡아야 하는 경우이고, 커밋 의무의 `git add -A` 도 그것을 담는다.
  // 무시되는 파일(빌드 산출물, node_modules)은 기본적으로 빠진다.
  //
  // **읽지 못한 status 는 0 이 아니다.** 실패·시간 초과·출력 한도로 답이 없으면 그 워크트리를
  // `unchecked` 에 담아 "확인하지 못했다"로 올린다. 병합은 막지 않는다 — 원본 워크트리의 변경은
  // 원래도 병합을 막지 않았고(경고만 한다), 막는 것은 합칠 폴더(위 2)뿐이다.
  // W5-A (#51): asked once; empty unless git has no identity in this folder.
  const ident = await mergeIdentityArgs(mergeInto, ctx.git ?? realGit)
  let uncommitted = 0
  const unchecked: string[] = []
  const dirtyPaths: string[] = []
  for (const target of targets) {
    const dirty = await (ctx.git ?? realGit)(['status', '--porcelain'], { cwd: target.path })
    if (!dirty.ok) {
      unchecked.push(target.path)
      ctx.log(`merge: could not check uncommitted changes in ${target.path} — git status failed: ${dirty.stderr}`)
    }
    // An untracked node_modules (the worktree's link to the project's) is no work of the worker's
    const n = dirty.ok ? dirty.stdout.split('\n').filter((l) => l !== '' && !/^\?\? "?node_modules\/?"?$/.test(l)).length : 0
    if (n > 0) {
      ctx.log(`merge: ${target.path} has ${n} uncommitted change(s) — not merged`)
      dirtyPaths.push(target.path)
    }
    uncommitted += n
    // 같은 이름의 태그가 브랜치보다 먼저 잡히는 것을 막으려고 전체 ref 를 쓴다(remove.ts 와 같다)
    const ref = `refs/heads/${target.branch}`
    // merge-tree --write-tree writes tree objects and on a big repository can run long; the long write
    // ceiling keeps a slow probe from being killed and misreported as "could not test".
    const probe = await (ctx.git ?? realGit)(['merge-tree', '--write-tree', 'HEAD', ref], {
      cwd: mergeInto,
      timeoutMs: GIT_WRITE_TIMEOUT_MS
    })
    if (!probe.ok)
      return {
        kind: 'agent',
        // **0 이 아닌 것에는 두 가지가 섞여 있다** — 충돌과 "명령이 아예 못 돌았다"(없는 ref,
        // 커밋이 없는 HEAD …). git() 은 ok 하나만 주므로 종료 코드로는 가를 수 없고, 임시
        // 저장소에서 실측한 결과 둘 다 exit 1 이었다(오류가 128 이라는 보장도 없다). 대신
        // **stderr 가 갈라 준다**: 충돌일 때 merge-tree 는 결과를 stdout 에 쓰고 stderr 를
        // 비우며(273바이트/0바이트), 없는 ref 에서는 stdout 이 비고 stderr 에
        // "merge-tree: refs/heads/nope - not something we can merge" 가 온다.
        //
        // 가는 곳은 어느 쪽이든 에이전트다. 가르는 것은 **문장**이다: 실제로는 ref 가 잘못된
        // 것인데 spec 의 첫 문장이 "충돌한다"이면 에이전트는 없는 충돌을 찾아 헤매다 결국
        // `git merge` 를 돌려 진짜 오류를 다시 발견해야 한다. 앱이 아는 것을 그대로 넘긴다.
        reason: probe.stderr
          ? `the app could not test whether ${target.branch} merges into the branch this folder is on — git merge-tree failed: ${probe.stderr}`
          : `git merge-tree says ${target.branch} does not merge cleanly into the branch this folder is on`,
        worktrees: targets
      }
    // `--no-edit` 는 편집기를 막는 것이다. 이 자리에는 사람이 없고, 편집기가 뜨면 그 git 프로세스는
    // timeout 까지 서 있다가 죽는다 — 그때 남는 저장소가 곧 병합 중간 상태다.
    //
    // **병합과 그 되돌리기는 GIT_WRITE_TIMEOUT_MS(10분)로 돈다.** 어댑터 기본값(30초)이면 큰 저장소의
    // 병합이 일하는 도중에 죽어 바로 그 중간 상태를 남긴다. 느린 쓰기는 기다리고, 정말 매달린
    // 프로세스만 이 한도가 거둔다.
    //
    // **저장소를 실제로 움직이는 자리다** — mergeInto 의 HEAD 와 index 를 옮긴다. gitWatcher 가
    // 바로 그 둘을 보고 있으므로, 이 병합을 EG §26 에 등록해 두지 않으면 Astera 자신이 방금 만든
    // 변경이 "외부에서 저장소가 바뀌었다"로 기록된다(EG §41-9). `finally` 로 닫는 이유는 아래
    // 실패 분기가 그 안에서 그대로 `return` 하기 때문이다 — try 없이 두면 그 경로로 나갈 때
    // 등록이 영원히 "진행 중"으로 남고, 그날부터 이 프로젝트의 모든 외부 변경이 조용히 삼켜진다.
    // Awaited (R24): in the Host, begin first writes the HEAD before the merge to host/merges.json, so
    // an app that opens or attaches while the merge runs finds it there.
    // W8-A: the merge commit carries the Wave 8 trailers, and the repository the notes config. Asked before the merge is
    // announced, so the announcement stays right before the merge.
    await ensureNotesConfig(mergeInto, ctx.git ?? realGit)
    const how = await attributedMergeArgs(mergeInto, ref, opts.message, ctx.git ?? realGit)
    const mergeOpId = await ctx.gitOp.begin('job-merge', mergeInto)
    try {
      // W6-H: a delivery names its merges (`Fixes #n`), and a fast-forward would carry no message, so it gets a commit
      const mergeOnce = (): ReturnType<typeof realGit> =>
        (ctx.git ?? realGit)([...ident, 'merge', ...how], { cwd: mergeInto, timeoutMs: GIT_WRITE_TIMEOUT_MS })
      let merged = await mergeOnce()
      // Owner spec 2026-10-18, part 2: untracked files git ignores, or a node_modules symlink, never block the merge.
      // git refused before it began, so they are set aside and the merge runs once more.
      const aside = merged.ok ? null : await setAsideUntracked(mergeInto, merged.stderr, ctx.git ?? realGit)
      if (aside) merged = await mergeOnce()
      if (!merged.ok) {
        // 미리 검사가 통과했는데도 실패했다면 충돌이 아닌 이유다(추적되지 않는 파일과의 겹침,
        // index.lock, 훅, 서명). 되돌린 뒤 사람에게 간다 — 에이전트에게 넘기지 않는 이유는 이것이
        // "합치면 충돌한다"가 아니라 "앱이 병합을 돌릴 수 없다"이기 때문이다.
        // 병합이 시작되지도 않았으면 실패한다 — 무시한다
        await (ctx.git ?? realGit)(['merge', '--abort'], { cwd: mergeInto, timeoutMs: GIT_WRITE_TIMEOUT_MS })
        // **되돌아갔는지 확인해서 그 사실을 문장에 넣는다.** 앱이 저장소를 어떤 상태로 두었는지를
        // 사용자가 짐작하게 두지 않는다 — 이 경로가 있는 이유가 그것이다.
        if (aside) await restoreAside(aside, ctx.log)
        const after = await (ctx.git ?? realGit)(['status', '--porcelain', '--untracked-files=no'], { cwd: mergeInto })
        return human(after.ok && after.stdout === '' ? 'jobs.integration.mergeFailedRestored' : 'jobs.integration.mergeFailedLeft', {
          branch: target.branch ?? '',
          output: merged.stderr || merged.stdout
        })
      }
      if (aside) await restoreAside(aside, ctx.log)
    } finally {
      // A rejecting end is logged, not thrown: from a finally it would replace the merge's result.
      await Promise.resolve()
        .then(() => ctx.gitOp.end(mergeOpId))
        .catch((e: unknown) => ctx.log(`git-op end failed: ${String(e)}`))
    }
    ctx.log(`scheduler: merged ${ref} into ${mergeInto}`)
    // 합친 워크트리는 여기서 지운다 — **폴더까지. 단 `reap` 일 때만이다**(위 주석: 사람이 누른
    // 병합은 폴더를 남긴다). 예약이 이 자동 정리를 필수로 만들었다: 회차마다
    // 워커 수만큼 워크트리가 생기므로 사람이 손으로 지우는 것은 현실적이지 않다.
    //
    // 지우는 방법은 removeWorktree(core/worktrees/remove.ts)가 안다 — 탐색기의 워크트리 패널이
    // 쓰는 **같은 함수**다. 두 번째 제거 경로를 만들면 위험 경로 검사·사용 중 검사·브랜치 처리가
    // 두 벌이 되고, 한쪽만 고쳐지는 날 이쪽이 폴더를 잘못 지운다. 그 함수가 폴더 자체를
    // (`git worktree remove --force`) 지우고, 비게 된 저장소별 상위 폴더도 rmdir 하고,
    // 레지스트리 항목까지 걷는다.
    //
    // force: true — 합친 뒤 워크트리에 남는 것은 커밋되지 않은 변경과 추적되지 않는 파일뿐이고,
    // 커밋된 일은 방금 합칠 폴더로 들어갔다. 그 대가를 알고 고른 동작이다.
    //
    // **정리 실패가 병합을 망치지 않는다.** 병합은 이미 성공했고 결과물은 합칠 폴더에 있다 —
    // 정리가 안 됐다고 Gate 를 열면 사람이 손쓸 것도 없는 자리에서 파이프라인이 선다. 도는
    // 세션이 그 폴더를 쓰고 있으면 removeWorktree 가 IN_USE 로 던지고 **그것이 맞다**: 살아 있는
    // 프로세스 밑의 폴더는 지우지 않는다. 그때 그 워크트리는 남고 이유는 로그에 남는다.
    // A folder with uncommitted changes, or one whose status could not be read, is never reaped: the force remove
    // would take that work with it. It stays, reported in `dirty`/`unchecked`, and the caller does not count it merged.
    if (reap && dirty.ok && n === 0) await ctx.reap(target.path)
    else if (reap) ctx.log(`merge: kept ${target.path}: it holds uncommitted changes (or its status could not be read)`)
  }
  return {
    kind: 'merged',
    uncommitted,
    ...(unchecked.length > 0 ? { unchecked } : {}),
    ...(dirtyPaths.length > 0 ? { dirty: dirtyPaths } : {})
  }
}

export interface ReapContext {
  registry: WorktreeStore
  /** The sessions a reap may close in this folder, and whether anything still runs there. */
  sessions: {
    inTree(worktreePath: string): { id: string }[]
    anyRunningIn(worktreePath: string): boolean
    kill(id: string): void
  }
  dispatches(): readonly { sessionId: string; retained?: boolean; outcome?: unknown; endedAt?: string }[]
  isPathInUse(p: string): string | null
  log(m: string): void
  /** Asked right before the folder is removed, after its sessions are closed: a tag of what still
   *  uses it, or null. A tag refuses the removal as IN_USE does. The Host asks the attached app here
   *  (what the app runs itself is invisible to the Host); the app leaves it out. */
  beforeRemove?(worktreePath: string): Promise<string | null>
  /** Test seams; default to WORKTREE_CLOSE_TIMEOUT_MS and 50 ms. */
  closeTimeoutMs?: number
  pollMs?: number
}

/** 워크트리의 세션이 닫히기를 기다리는 상한. pty.kill 은 비동기이고 상태는 exit 이벤트가 와야
 *  바뀐다 — 고정 대기가 아니라 조건을 폴링하고(coordinator 의 waitUntilIdle 과 같은 관례) 이
 *  시간을 넘기면 정리를 건너뛴다. 살아 있는 프로세스 밑의 폴더는 지우지 않는다. */
export const WORKTREE_CLOSE_TIMEOUT_MS = 5_000
/** Rounds of fetch, catch up and push after a rejected delivery push (busy repos: several plans deliver at once). */
const PUSH_ROUNDS = 10
/**
 * 워크트리 하나를 폴더째 지운다 — 그 안에서 도는 세션을 먼저 닫고. true = 지워졌다.
 *
 * **두 곳이 이것을 쓴다**: 병합 직후의 자동 정리와 `run-delete --remove-worktrees`. 복제하면
 * "무엇을 닫아도 되는가" 의 답이 두 벌이 되고, 한쪽만 고쳐지는 날 다른 쪽이 살아 있는 세션 밑의
 * 폴더를 지운다.
 *
 * **세션을 먼저 닫는 이유**: 끝난 워커의 세션은 스스로 죽지 않는다 — worker-release 는 코디네이터가
 * 부르는 명령이고 앱이 자동으로 부르는 자리가 없다. 닫지 않으면 removeWorktree 의 isPathInUse 가
 * 늘 IN_USE 를 내고 이 정리는 사실상 한 번도 돌지 않는다.
 *
 * **닫지 않는 두 경우**: 붙잡아 둔 세션(worker-retain — 사람이 살려 두라고 말한 것)과 아직 열려
 * 있는 Dispatch 의 세션(지금 일하는 중이다). 그때는 아무것도 닫지 않고 그 워크트리를 그대로 둔다 —
 * removeWorktree 가 IN_USE 로 거절하는 것이 그 결과다. run-delete 가 retained 에 같은 예외를 둔다.
 */
export async function reapWorktree(worktreePath: string, ctx: ReapContext): Promise<boolean> {
  const inTree = ctx.sessions.inTree(worktreePath)
  const held = ctx.dispatches().some(
    (d) =>
      (d.retained || (!d.outcome && !d.endedAt)) && inTree.some((x) => x.id === d.sessionId)
  )
  if (held) {
    ctx.log(`worktree ${worktreePath} has a held or working session — left alone`)
    return false
  }
  for (const x of inTree) ctx.sessions.kill(x.id)
  // 조건 폴링. 상태가 바뀌는 것을 기다리는 것이지 정해진 시간을 자는 것이 아니다
  const deadline = Date.now() + (ctx.closeTimeoutMs ?? WORKTREE_CLOSE_TIMEOUT_MS)
  while (Date.now() < deadline && ctx.sessions.anyRunningIn(worktreePath))
    await new Promise((r) => setTimeout(r, ctx.pollMs ?? 50))
  const entry = ctx.registry.list().find((w) => isSamePath(w.path, worktreePath))
  if (!entry) {
    ctx.log(`${worktreePath} is not an app worktree — left alone`)
    return false
  }
  try {
    if (ctx.beforeRemove) {
      const busy = await ctx.beforeRemove(worktreePath)
      if (busy !== null) throw new Error(`IN_USE: ${busy}`)
    }
    const removed = await removeWorktree({
      id: entry.id,
      force: true,
      registry: ctx.registry,
      isPathInUse: ctx.isPathInUse
    })
    ctx.log(`removed worktree ${worktreePath} (branch deleted=${removed.branchDeleted})`)
    return true
  } catch (e) {
    ctx.log(`worktree cleanup skipped for ${worktreePath}: ${String(e)}`)
    return false
  }
}

/** The two OrchServerDeps bodies that merge and remove a Run's worktrees, over one context. */
export function worktreeDeps(ctx: {
  integrate(into: string, paths: string[], opts: { reap?: boolean; message?: string }): Promise<Integration>
  reap(p: string): Promise<boolean>
  log(m: string): void
  /** Whether a folder is there, asked asynchronously with a time limit. Test seam; defaults to the
   *  process-wide action-lane check (worktrees/presence.ts). */
  presence?: PresenceCheck
  /** Test seam for the status reads; defaults to the real git. */
  git?: typeof realGit
}): {
  mergeWorktrees: NonNullable<OrchServerDeps['mergeWorktrees']>
  removeWorktrees: NonNullable<OrchServerDeps['removeWorktrees']>
} {
  // **폴더가 있는지는 비동기로, 시간 제한을 두고 묻는다**(worktrees/presence.ts). 동기 existsSync 는
  // 끊긴 네트워크 공유 위의 워크트리 하나에서 앱의 메인 스레드나 Host 의 스레드를 20~60초 세웠다.
  // 그리고 **"없다"는 부모가 답하는 ENOENT 뿐이다.** 시간 초과·거절·그 밖의 오류는 "모른다"이고,
  // 모르는 폴더는 없는 것으로 치지 않는다: 합치지도, 지우지도 않고 unchecked 로 올린다. 그 폴더에서
  // git 을 돌리지도 않는다 — 닿지 않는 폴더를 cwd 로 띄우는 것 자체가 같은 자리에서 멈출 수 있다.
  // The action lane (one call per root), and a refusal asked again: see askUntilAnswered.
  const presenceOf = (p: string): Promise<CheckResult> => askUntilAnswered(ctx.presence ?? defaultActionPresenceCheck, p)
  const sort = async (paths: string[]): Promise<{ alive: string[]; gone: string[]; unknown: string[] }> => {
    const answers = await Promise.all(paths.map((p) => presenceOf(p)))
    return {
      alive: paths.filter((_, i) => answers[i] === 'present'),
      gone: paths.filter((_, i) => answers[i] === 'missing'),
      unknown: paths.filter((_, i) => answers[i] !== 'present' && answers[i] !== 'missing')
    }
  }
  return {
    // `run-merge`(사람이 상세 창에서 누른다)와 `run-delete --merge` 가 부른다.
    // integrateWorktrees 의 'agent'(충돌 → 에이전트에게 넘김)도 여기서는 실패다 — 사람이 결과를
    // 기다리고 있고, 지우는 경로에서는 넘길 Run 자체가 사라지는 중이라 통합 Task 를 붙일 자리가
    // 없다. 두 경우 모두 이유를 그대로 올려 보내 사람이 무엇을 해야 하는지 읽게 한다.
    //
    // **`reap: false`** — 이 두 호출자는 폴더를 남긴다(그 이유는 integrateWorktrees 의 주석).
    //
    // **폴더가 있는지로 거른다 — 레지스트리 등록 여부가 아니다.** "합칠 수 있는가"와 "앱이 지워도
    // 되는가"는 다른 질문이다. 뒤쪽만 레지스트리의 것이다(reapableChildRuns 의 isAppWorktree — 그
    // 판정은 이 이유로 바뀌지 않는다). integrateWorktrees 는 git 자신의 `worktree list`에서 브랜치를
    // 찾으므로, 앱이 만들었지만 아직(또는 더 이상) 레지스트리에 없는 워크트리도 git 에게는 멀쩍이
    // 합칠 수 있는 대상이다 — 오케스트레이터가 스스로 만들어 `worker-start --worktree <path>` 로
    // 띄워 넣은, 살아서 일하고 있는 워크트리가 레지스트리 필터 때문에 조용히 걸러지던 것이 바로
    // 그 결함이었다. 재료 `paths`(runWorktrees, `Dispatch.cwd` 를 본다)에 남을 수 있는 건 이제
    // 하나뿐이다: 폴더 자체가 사라진 경우(통합 병합이 이미 걷어 갔거나 예약 회차가 걷혔다) —
    // 그것만 거른다. 닿지 않는 폴더는 합치지 않고 notMerged 로 올린다: 그 폴더의 커밋되지 않은
    // 변경을 셀 수 없고, `run-delete --merge --remove-worktrees` 는 그 폴더를 남긴다.
    mergeWorktrees: async (runCwd, paths, opts) => {
      const { alive, gone, unknown } = await sort(paths)
      if (gone.length > 0)
        ctx.log(`merge: skipping ${gone.length} removed worktree(s): ${gone.join(', ')}`)
      if (unknown.length > 0)
        ctx.log(`merge: could not reach ${unknown.length} worktree(s), not merged: ${unknown.join(', ')}`)
      // 닿지 못해 합치지 않은 것은 "변경을 확인하지 못했다"(unchecked)가 아니라 "합치지 않았다"다.
      const unreached = unknown.length > 0 ? { notMerged: unknown } : {}
      // 남은 것이 없으면 성공이다 — 합칠 것이 없는 것은 실패가 아니고, 여기서 실패로 내면 사람이
      // 손쓸 수 없는 이유로 병합 버튼과 삭제가 막힌다.
      if (alive.length === 0) return { ok: true, merged: [], uncommitted: 0, ...unreached }
      const r = await ctx.integrate(runCwd, alive, { reap: false, ...(opts?.message !== undefined ? { message: opts.message } : {}) })
      // An `agent` result names its worktrees: run-merge and run-integrate-all hand them to the AI merge Task
      if (r.kind !== 'merged') return { ok: false, reason: r.reason, ...(r.kind === 'agent' ? { conflict: r.worktrees } : {}) }
      return {
        ok: true,
        merged: alive,
        uncommitted: r.uncommitted,
        ...(r.unchecked ? { unchecked: r.unchecked } : {}),
        ...(r.dirty ? { dirty: r.dirty } : {}),
        ...unreached
      }
    },
    // `run-delete --remove-worktrees` 가 부른다. 순차로 지운다 — reapWorktree 가 세션을 닫고
    // 상태가 바뀌기를 기다리므로, 병렬로 돌리면 서로의 폴링이 남의 세션을 기다린다.
    //
    // **커밋되지 않은 변경이 있거나 그것을 확인하지 못한 폴더는 지우지 않는다.** reap 은 --force 로
    // 지우므로, 그 변경은 폴더와 함께 조용히 사라진다. `run-delete --merge` 는 병합이 센 사실로 이미
    // 그런 폴더를 남겼지만, --merge 없이는 아무도 세지 않았다. 그래서 여기서 폴더마다 status 를
    // 읽는다(`--porcelain` 의 기본값: 추적되지 않는 파일도 센다, integrateWorktrees 와 같다). 읽지
    // 못한 status 는 0 이 아니라 "모른다"다. 남긴 폴더는 `failed`(지워지지 않았다)에도 들고,
    // `dirty`·`unchecked` 가 그 이유를 말한다. 자동 통합 병합의 reap 은 이 길을 지나지 않는다.
    removeWorktrees: async (paths) => {
      const failed: string[] = []
      const dirty: string[] = []
      const unchecked: string[] = []
      let uncommitted = 0
      for (const p of paths) {
        const at = await presenceOf(p)
        // **이미 없는 폴더는 실패가 아니다.** Dispatch 의 cwd 는 워크트리를 지운 뒤에도 상태에 남으므로
        // 그런 경로가 여기까지 온다 — reapWorktree 는 그것을 "앱 워크트리가 아니다" 로 거절하고 false 를
        // 내는데, 그것을 failed 에 담으면 사용자에게 "이 폴더를 지우지 못했습니다" 로 보고된다.
        // 요청한 끝 상태는 이미 그것이다. mergeWorktrees 가 같은 이유로 같은 판정을 한다.
        if (at === 'missing') {
          ctx.log(`remove: skipping already removed worktree ${p}`)
          continue
        }
        if (at !== 'present') {
          ctx.log(`remove: could not reach worktree ${p} (${at}), kept`)
          unchecked.push(p)
          failed.push(p)
          continue
        }
        const st = await (ctx.git ?? realGit)(['status', '--porcelain'], { cwd: p })
        if (!st.ok) {
          ctx.log(`remove: could not check uncommitted changes in ${p}, kept: git status failed: ${st.stderr}`)
          unchecked.push(p)
          failed.push(p)
          continue
        }
        const n = st.stdout === '' ? 0 : st.stdout.split('\n').length
        if (n > 0) {
          ctx.log(`remove: ${p} has ${n} uncommitted change(s), kept`)
          uncommitted += n
          dirty.push(p)
          failed.push(p)
          continue
        }
        if (!(await ctx.reap(p))) failed.push(p)
      }
      return {
        failed,
        uncommitted,
        ...(dirty.length > 0 ? { dirty } : {}),
        ...(unchecked.length > 0 ? { unchecked } : {})
      }
    }
  }
}

// ── T11: a plan refreshed onto another plan's delivery ──────────────────────────────────────────────────────────────

/** How `refreshOnto` ended: `current` the worktree already holds the commit, `merged` it was merged in, `conflict` it
 *  does not merge cleanly (nothing was written; an integration Task resolves it), `human` the worktree cannot be merged
 *  into at all (not on a branch, uncommitted changes, git refused), so it was left as it was. */
export type Refresh = { kind: 'current' } | { kind: 'merged' } | { kind: 'conflict'; reason: string } | { kind: 'human'; reason: string }

/**
 * **T11: merges `base` (a commit another plan of the project delivered) into a worktree of a plan still running**, so
 * the plan's next Task starts on the new base and its own delivery does not collide. A merge, never a rebase: the
 * worktree's commits keep their ids. The guards of integrateWorktrees: a worktree off a branch or with uncommitted
 * tracked changes is left alone, and a conflict is found by `merge-tree --write-tree` before anything is written.
 */
export async function refreshOnto(
  worktree: string,
  base: string,
  message: string,
  ctx: {
    log(m: string): void
    git?: typeof realGit
    gitAtLeast?: typeof gitVersionAtLeast
    fetchBranch?: string
    /** T1: the plan's project folder (the Job's cwd), which may be another clone than the worktree's repository: where
     *  the delivered commit is looked for when origin does not give it. */
    projectDir?: string
  }
): Promise<Refresh> {
  const run = ctx.git ?? realGit
  if ((await run(['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: worktree })).ok) return { kind: 'current' }
  // A merged pull request's commit is on origin only until fetched: never mistaken for a conflict
  const known = async (): Promise<boolean> => (await run(['cat-file', '-e', `${base}^{commit}`], { cwd: worktree })).ok
  if (!(await known())) {
    const tried = await fetchMissing(worktree, base, ctx.fetchBranch, ctx.projectDir, run, known)
    if (tried !== null) return { kind: 'human', reason: `${base} is not in ${worktree}'s repository, so it was not merged. Tried: ${tried}` }
    if ((await run(['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: worktree })).ok) return { kind: 'current' }
  }
  if (!(await run(['symbolic-ref', '--quiet', 'HEAD'], { cwd: worktree })).ok)
    return { kind: 'human', reason: `${worktree} is not on a branch (or git cannot run there), so ${base} was not merged into it` }
  const status = await run(['status', '--porcelain', '--untracked-files=no'], { cwd: worktree })
  if (!status.ok || status.stdout !== '')
    return { kind: 'human', reason: `${worktree} has uncommitted changes (or its git status cannot be read), so ${base} was not merged into it` }
  if (!(await (ctx.gitAtLeast ?? gitVersionAtLeast)(2, 38)))
    return { kind: 'conflict', reason: `this git is older than 2.38, so the app cannot test whether ${base} merges into ${worktree}` }
  const probe = await run(['merge-tree', '--write-tree', 'HEAD', base], { cwd: worktree, timeoutMs: GIT_WRITE_TIMEOUT_MS })
  if (!probe.ok)
    return {
      kind: 'conflict',
      reason: probe.stderr
        ? `git merge-tree could not test ${base} against ${worktree}: ${probe.stderr}`
        : `${base} does not merge cleanly into ${worktree}`
    }
  const ident = await mergeIdentityArgs(worktree, run)
  const merged = await run([...ident, 'merge', '--no-ff', '-m', message, base], { cwd: worktree, timeoutMs: GIT_WRITE_TIMEOUT_MS })
  if (!merged.ok) {
    await run(['merge', '--abort'], { cwd: worktree, timeoutMs: GIT_WRITE_TIMEOUT_MS })
    return { kind: 'human', reason: `merging ${base} into ${worktree} failed: ${(merged.stderr || merged.stdout).trim()}` }
  }
  ctx.log(`refresh: merged ${base} into ${worktree}`)
  return { kind: 'merged' }
}

/** T1: brings a commit the worktree's repository lacks, one source after another until it is there: origin (its
 *  `fetchBranch`, else all of it), the project folder's own origin, then the project folder itself as a local remote
 *  (its branches and its origin refs, under `refs/astera/project/`). Null once the commit is there; else each try and
 *  the tail of what git said, for the reason a person reads. */
async function fetchMissing(
  worktree: string,
  sha: string,
  fetchBranch: string | undefined,
  projectDir: string | undefined,
  run: typeof realGit,
  known: () => Promise<boolean>
): Promise<string | null> {
  const tail = (r: { ok: boolean; stderr: string; stdout: string }): string =>
    r.ok ? `fetched, but ${sha.slice(0, 7)} was not there` : ((r.stderr || r.stdout).trim().split('\n').at(-1) ?? '') || 'failed'
  const tries: { what: string; cwd: string; args: string[] }[] = [
    { what: `git fetch origin ${fetchBranch ?? ''}`.trim() + ` in ${worktree}`, cwd: worktree, args: ['fetch', 'origin', ...(fetchBranch ? [fetchBranch] : [])] }
  ]
  if (projectDir !== undefined) {
    tries.push({ what: `git fetch origin in the project folder ${projectDir}`, cwd: projectDir, args: ['fetch', 'origin', ...(fetchBranch ? [fetchBranch] : [])] })
    tries.push({
      what: `git fetch ${projectDir} (the project folder as a remote)`,
      cwd: worktree,
      args: ['fetch', '--no-tags', projectDir, '+refs/heads/*:refs/astera/project/heads/*', '+refs/remotes/origin/*:refs/astera/project/origin/*']
    })
  }
  const said: string[] = []
  for (const t of tries) {
    const r = await run(t.args, { cwd: t.cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS })
    if (await known()) return null
    said.push(`${t.what}: ${tail(r)}`)
  }
  return said.join('; ')
}

/** The worktrees whose HEAD no other one in the list already holds: merging those brings everything. A worktree whose
 *  HEAD cannot be read is kept, so nothing is dropped on a guess. */
async function tipsOf(worktrees: string[], run: typeof realGit): Promise<string[]> {
  const heads = await Promise.all(worktrees.map(async (w) => {
    const r = await run(['rev-parse', 'HEAD'], { cwd: w })
    return r.ok ? r.stdout : null
  }))
  const out: string[] = []
  for (let i = 0; i < worktrees.length; i++) {
    const h = heads[i]
    let held = false
    for (let j = 0; h !== null && !held && j < worktrees.length; j++) {
      const o = heads[j]
      if (j === i || o === null) continue
      // Equal HEADs: the later one stands for both
      held = o === h ? j > i : (await run(['merge-base', '--is-ancestor', h, o], { cwd: worktrees[i] })).ok
    }
    if (!held) out.push(worktrees[i])
  }
  return out
}

// ── W6-H: a `push` delivery ─────────────────────────────────────────────────────────────────────────────────────────

/** What `deliverByPush` needs: the project folder, the branch to land on (absent: origin's default), the Run's
 *  worktrees and the message of each merge commit (`deliveryMessage`, with its `Fixes #n`). */
export interface PushDelivery {
  cwd: string
  branch?: string
  /** W8-G: the project's recorded default branch, used when `branch` is absent and origin has no HEAD ref. */
  defaultBranch?: string
  worktrees: string[]
  message: string
  /** T3: the owner said they push the plan themselves: nothing is merged or pushed, the answer only says whether every
   *  worktree's HEAD is on `branch` (local or origin's, `git branch -a --contains`). T1: or its changes are on
   *  origin's branch by other commits (a rebase or cherry-pick landing: `git cherry` marks every commit `-`). */
  ownerPushed?: boolean
  /** T6 `merge` delivery: the same merge and validation on this computer, with no remote: nothing is fetched or pushed,
   *  and with no branch set the folder's own branch is the target when origin names none. */
  local?: boolean
}

export interface PushContext {
  /** The merge `run-merge` makes, with the delivery's message (worktreeDeps' `mergeWorktrees`). */
  mergeWorktrees: NonNullable<OrchServerDeps['mergeWorktrees']>
  /** The project's validation, once, in the merged folder. `ran`: how many checks ran (0: none configured). */
  validate(cwd: string): Promise<{ ok: true; ran: number } | { ok: false; reason: string }>
  /** Installs the dependencies in the merged folder, even when node_modules exists (the project's setup command). */
  install(cwd: string): Promise<{ ok: true } | { ok: false; reason: string }>
  log(m: string): void
  /** Test seam; defaults to the real git. */
  git?: typeof realGit
  /** Test seam for `refreshOnto`'s git version check; defaults to the real one. */
  gitAtLeast?: typeof gitVersionAtLeast
  /** T3: who is told Astera moves HEAD for the catch-up merge with origin (integrateWorktrees' own). Optional. */
  gitOp?: IntegrateContext['gitOp']
}

/** T3: why a push delivery stopped part-way, for the caller to tell a retry from an integration Task: `fetch-failed`
 *  origin could not be read, `rejected` origin kept refusing the push, `origin-conflict` origin moved on and does not
 *  merge with the plan, `merge-failed` the plan's worktrees did not merge into the branch, T1: `main-diverged` the
 *  folder's branch has commits origin does not, so it cannot fast-forward (the owner's to fix; retried by itself), T5:
 *  `validation-failed` the checks failed on the merged result (a hands-free plan opens a fix Task for it). */
export type PushStop = 'fetch-failed' | 'rejected' | 'origin-conflict' | 'merge-failed' | 'main-diverged' | 'validation-failed'

export type PushResult =
  | { ok: true; branch: string; sha: string; merged: string[]; validated: number }
  | { ok: false; reason: string; branch?: string; code?: PushStop; /** origin-conflict: origin's commit the plan clashes with */ conflictWith?: string }

/**
 * **Lands a finished plan on a branch and pushes it, with no person reviewing** (W6-H). Every guard stops the push and
 * answers why, for the caller to escalate; nothing here stashes, resets or overwrites the owner's own work:
 * 1. the branch is `branch`, else origin's default (`refs/remotes/origin/HEAD`); neither is a stop;
 * 2. the folder stands on that branch with no uncommitted tracked change (T3: untracked files never block: no merge or
 *    reset here touches them);
 * 3. `fetch`, then `merge --ff-only` from origin; a local branch that cannot fast-forward is a stop;
 * 4. the Run's worktrees merge (`mergeWorktrees`). T11: when that fails (another plan landed on the branch first), the
 *    folder goes back to the commit recorded before it, the plan's worktrees are refreshed onto that commit
 *    (`refreshOnto`) and merged once more; T3: a second failure undoes the merges as 5 does;
 * 5. the validation runs on the merged folder, after an install when the merges changed package.json or a lockfile; a failure resets to the commit recorded before 4, which undoes only
 *    Astera's merges (the folder was clean at 2);
 * 6. `push origin <branch>`, **never forced**; a rejected push fetches, and when origin moved on merges it in and runs
 *    the validation again, then pushes; up to `PUSH_ROUNDS` times. T3: every stop here (a conflict with origin, a
 *    failed fetch, a push still rejected, a failed second validation) undoes the merges as 5 does, so no half
 *    delivery sits unpushed on the owner's branch.
 * The undo resets only while the folder is still on `branch` with no tracked change Astera did not make.
 * T6 `local` (a `merge` delivery) skips 3 and 6: it ends after the validation, the merges left on the folder's branch.
 */
export async function deliverByPush(a: PushDelivery, ctx: PushContext): Promise<PushResult> {
  const run = ctx.git ?? realGit
  const cwd = a.cwd
  const w = { cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS }
  const why = (r: { stderr: string; stdout: string }): string => (r.stderr || r.stdout).trim()

  // 1.
  let branch = a.branch
  if (branch === undefined) {
    const head = await run(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd })
    if (head.ok && head.stdout.startsWith('origin/')) branch = head.stdout.slice('origin/'.length)
    else if (a.defaultBranch) branch = a.defaultBranch
    else if (a.local) {
      const own = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd })
      if (!own.ok) return { ok: false, reason: `your folder ${cwd} is not on a branch (detached HEAD); set the project's delivery branch` }
      branch = own.stdout
    } else return { ok: false, reason: `could not tell the repository's default branch (origin/HEAD is not set): set the project's delivery branch` }
  }
  const fail = (reason: string, code?: PushStop, conflictWith?: string): PushResult => ({
    ok: false,
    reason,
    branch,
    ...(code ? { code } : {}),
    ...(conflictWith ? { conflictWith } : {})
  })

  // T3: the owner pushed it: is every worktree's HEAD on the branch, here or on origin? Nothing is written. T6: a local
  // delivery asks the local branch only
  const landed = a.local ? branch : `origin/${branch}`
  if (a.ownerPushed) {
    if (!a.local) await run(['fetch', 'origin', branch], w)
    for (const wt of a.worktrees) {
      const head = await run(['rev-parse', 'HEAD'], { cwd: wt })
      if (!head.ok) continue // a folder already gone holds nothing that is not somewhere else
      const holders = await run(['branch', '-a', '--contains', head.stdout, '--format=%(refname:short)'], { cwd })
      const names = holders.ok ? holders.stdout.split('\n').map((x) => x.trim()) : []
      if (names.includes(branch) || names.includes(`origin/${branch}`)) continue
      // T1: patch-equivalent commits on origin (no `+`: none of the plan's changes is missing there)
      const cherry = await run(['cherry', landed, head.stdout], { cwd })
      if (cherry.ok && !cherry.stdout.split('\n').some((l) => l.startsWith('+'))) continue
      // A squash merge of several commits has `+` lines for every one: if merging the worktree into origin changes nothing,
      // everything from it is already there
      const merged = await run(['merge-tree', '--write-tree', landed, head.stdout], { cwd })
      const tree = await run(['rev-parse', `${landed}^{tree}`], { cwd })
      if (merged.ok && tree.ok && merged.stdout.split('\n')[0] === tree.stdout) continue
      return fail(`${wt}'s commit ${head.stdout.slice(0, 7)} is not on ${branch} yet`)
    }
    const tip = await run(['rev-parse', landed], { cwd })
    return { ok: true, branch, sha: tip.ok ? tip.stdout : '', merged: [], validated: 0 }
  }

  // 2.
  const on = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd })
  if (!on.ok) return fail(`your folder ${cwd} is not on a branch (detached HEAD); put it on ${branch}`)
  if (on.stdout !== branch) return fail(`your folder ${cwd} is on branch ${on.stdout}, not ${branch}`)
  const status = await run(['status', '--porcelain', '--untracked-files=no'], { cwd })
  if (!status.ok) return fail(`could not read git status in ${cwd}: ${why(status)}`)
  if (status.stdout !== '') return fail(`your folder ${cwd} has ${status.stdout.split('\n').length} uncommitted change(s)`)

  // 3. T6: a local delivery has no origin to catch up with
  if (!a.local) {
    const fetched = await run(['fetch', 'origin', branch], w)
    if (!fetched.ok) return fail(`git fetch origin ${branch} failed: ${why(fetched)}`, 'fetch-failed')
    const ff = await run(['merge', '--ff-only', `origin/${branch}`], w)
    // T1: coded, so a retry tells it apart: it delivers by itself once the owner fixed their branch
    if (!ff.ok) return fail(`your ${branch} cannot fast-forward to origin/${branch} (it has commits origin does not): ${why(ff)}`, 'main-diverged')
  }

  // 4.
  const before = await run(['rev-parse', 'HEAD'], { cwd })
  if (!before.ok) return fail(`could not read HEAD in ${cwd}: ${why(before)}`)
  const base = before.stdout
  let merged = await ctx.mergeWorktrees(cwd, a.worktrees, { message: a.message })
  // T11: refresh, then deliver once more. The worktrees holding everything are refreshed onto `base` and only they merge
  if (!merged.ok) {
    ctx.log(`delivery: merging into ${branch} failed (${merged.reason}); refreshing the plan onto ${base} and trying once more`)
    let stop: string | null = null
    const now = await run(['rev-parse', 'HEAD'], { cwd })
    if (!now.ok || now.stdout !== base) {
      // Only Astera's own merges are above `base` (the folder was clean at 2), as in `undo` below
      if ((await backupRef(cwd, 'HEAD', 'reset-hard-delivery-retry', ctx.log, run)) === null) stop = `could not write a backup ref of HEAD before going back to ${base}`
      else {
        const reset = await run(['reset', '--hard', base], w)
        const back = await run(['rev-parse', 'HEAD'], { cwd })
        if (!reset.ok || !back.ok || back.stdout !== base) stop = `could not go back to ${base} to try again: ${why(reset)}`
      }
    }
    const tips = stop === null ? await tipsOf(a.worktrees, run) : []
    for (const wt of tips) {
      if (stop !== null) break
      const r = await refreshOnto(wt, base, `Refresh onto ${branch} before delivery`, { log: ctx.log, git: run, ...(ctx.gitAtLeast ? { gitAtLeast: ctx.gitAtLeast } : {}) })
      if (r.kind === 'conflict' || r.kind === 'human') stop = r.reason
    }
    if (stop === null) {
      const again = await ctx.mergeWorktrees(cwd, tips, { message: a.message })
      merged = again.ok ? again : { ok: false, reason: `${merged.reason}; after refreshing onto ${base}: ${again.reason}` }
    } else merged = { ok: false, reason: `${merged.reason}; refreshing onto ${base} did not help: ${stop}` }
  }
  /** Undoes Astera's merges: back to `base`, the clean commit recorded before them. T3: only while the folder is still on
   *  `branch` with no tracked change (the owner may have moved on meanwhile; their work is never reset). */
  const undo = async (reason: string, code?: PushStop, conflictWith?: string): Promise<PushResult> => {
    const now = await run(['rev-parse', 'HEAD'], { cwd })
    if (now.ok && now.stdout === base) return fail(reason, code, conflictWith)
    const still = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd })
    const clean = await run(['status', '--porcelain', '--untracked-files=no'], { cwd })
    if (!still.ok || still.stdout !== branch || !clean.ok || clean.stdout !== '')
      return fail(
        `${reason} Your folder changed meanwhile, so Astera's merges were left on ${branch}, not pushed; git reset --hard ${base} undoes them.`,
        code,
        conflictWith
      )
    if ((await backupRef(cwd, 'HEAD', 'reset-hard-delivery-undo', ctx.log, run)) === null)
      return fail(`${reason} Astera's merges were left on ${branch}, not pushed: no backup ref could be written; git reset --hard ${base} undoes them.`, code, conflictWith)
    const reset = await run(['reset', '--hard', base], w)
    const back = await run(['rev-parse', 'HEAD'], { cwd })
    if (!reset.ok || !back.ok || back.stdout !== base)
      return fail(`${reason} Astera could not undo its merges (git reset --hard ${base}: ${why(reset)}); check ${cwd} by hand.`, code, conflictWith)
    ctx.log(`delivery: undid Astera's merges in ${cwd}, back at ${base}`)
    return fail(`${reason} Astera's merges were undone; ${branch} is back at ${base}.`, code, conflictWith)
  }
  if (!merged.ok) return undo(`merging the plan's worktrees failed: ${merged.reason}`, 'merge-failed')
  const left = [...(merged.dirty ?? []), ...(merged.unchecked ?? []), ...(merged.notMerged ?? [])]
  if (left.length > 0) return undo(`these worktrees hold work that was not merged (uncommitted, or not reachable): ${left.join(', ')}.`)

  // 5. The merges may add a dependency: validating against the old node_modules fails on a module that is not there
  const validateMerged = async (): Promise<{ ok: true; ran: number } | { ok: false; reason: string }> => {
    const changed = await run(['diff', '--name-only', base, 'HEAD'], { cwd })
    const manifests = new Set(['package.json', ...LOCKFILES.flatMap(([files]) => files)])
    // An unknown diff counts as changed: skipping the install here is how the merged validation ran without its dependencies
    if (!changed.ok || changed.stdout.split('\n').some((f) => manifests.has(path.posix.basename(f)))) {
      ctx.log(
        changed.ok
          ? `delivery: package.json or a lockfile changed since ${base}, installing dependencies in ${cwd}`
          : `delivery: could not list the changes since ${base} (${why(changed)}), installing dependencies in ${cwd} to be safe`
      )
      const installed = await ctx.install(cwd)
      if (!installed.ok) return { ok: false, reason: `installing the dependencies failed: ${installed.reason}` }
    }
    return ctx.validate(cwd)
  }
  const checked = await validateMerged()
  if (!checked.ok) return undo(`the validation failed on the merged ${branch}: ${checked.reason}`, 'validation-failed')
  if (a.local) {
    const sha = await run(['rev-parse', 'HEAD'], { cwd })
    return { ok: true, branch, sha: sha.ok ? sha.stdout : '', merged: merged.merged, validated: checked.ran }
  }

  // 6. Origin can move on while the validation runs (another plan's delivery, a teammate's push). Its commits are merged
  // in, the result validated again (a clean merge can still clash, e.g. two migrations taking one number), then pushed;
  // never forced
  let pushed = await run(['push', 'origin', branch], w)
  let validated = checked.ran
  const ident = pushed.ok ? [] : await mergeIdentityArgs(cwd, run)
  for (let round = 1; !pushed.ok && round <= PUSH_ROUNDS; round++) {
    ctx.log(`delivery: push of ${branch} was rejected (${why(pushed)}), fetching (round ${round} of ${PUSH_ROUNDS})`)
    const refetched = await run(['fetch', 'origin', branch], w)
    if (!refetched.ok)
      return undo(`git push origin ${branch} was rejected (${why(pushed)}), and fetching origin to catch up failed: ${why(refetched)}.`, 'fetch-failed')
    if (!(await run(['merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD'], { cwd })).ok) {
      // T3: a merge commit needs an identity (none on a fresh machine), and the app's git watcher is told it is Astera's
      const op = ctx.gitOp ? await ctx.gitOp.begin('job-merge', cwd) : null
      let caught: Awaited<ReturnType<typeof run>>
      try {
        caught = await run([...ident, 'merge', '--no-edit', `origin/${branch}`], w)
        if (!caught.ok) await run(['merge', '--abort'], w)
      } finally {
        if (op !== null) await Promise.resolve(ctx.gitOp!.end(op)).catch((e) => ctx.log(`delivery: git-op end failed: ${String(e)}`))
      }
      if (!caught.ok) {
        const tip = await run(['rev-parse', `origin/${branch}`], { cwd })
        return undo(
          `origin/${branch} moved on during the delivery and does not merge cleanly with the plan: ${why(caught)}.`,
          'origin-conflict',
          tip.ok ? tip.stdout : undefined
        )
      }
      const rechecked = await validateMerged()
      if (!rechecked.ok) return undo(`the validation failed after merging origin/${branch}, which moved on during the delivery: ${rechecked.reason}`, 'validation-failed')
      validated = rechecked.ran
    }
    pushed = await run(['push', 'origin', branch], w)
  }
  if (!pushed.ok) return undo(`git push origin ${branch} was rejected: ${why(pushed)}.`, 'rejected')
  // W8-A: the notes ref goes next to the branch; a rejected notes push costs the delivery nothing
  if ((await pushNotes(cwd, run)) === 'rejected') ctx.log(`delivery: the attribution notes (refs/notes/astera) were not pushed`)
  const sha = await run(['rev-parse', 'HEAD'], { cwd })
  return { ok: true, branch, sha: sha.ok ? sha.stdout : '', merged: merged.merged, validated }
}
