// Korean · common area. Which files each area serves: ../README.md.
export const common = {
  'settings.title': '설정',
  'settings.tab.accounts': '계정',
  'higgsfield.add': '계정 추가',
  'higgsfield.login': '로그인',
  'higgsfield.remove': '삭제',
  'higgsfield.cancelLogin': '취소',
  'wall.scope.all': '모든 프로젝트',
  'wall.new': '새 콘솔',
  'settings.general.language': '언어',
  // {lang} is the language the OS locale resolves to, shown so the effect of picking System is
  // visible before picking it
  'settings.general.language.system': '시스템 설정 ({lang})',
  'settings.general.language.saveFailed': '언어 설정을 저장하지 못했습니다: {detail}',
  'settings.cli.hint':
    '설치하면 보통 셸에서도 astera 를 칠 수 있습니다. ' +
    '앱이 셸 설정 파일을 고치지는 않습니다. PATH 에 없으면 넣는 방법을 보여 드립니다.',
  'settings.cli.offer': '터미널에서도 astera 명령으로 세션과 Job 을 시작하고 다룰 수 있습니다. 앱을 꺼 둔 채로도 됩니다.',
  'settings.cli.offer.open': '설정 열기',
  'settings.cli.pathRepaired.toast':
    '사용자 PATH 에서 astera 폴더를 뺐습니다. 이 항목 때문에 PATH 가 너무 길어져 Windows 가 새로 여는 창에 사용자 PATH 를 통째로 넣지 않고 있었습니다. ' +
    '다른 도구는 새 창에서 다시 찾아집니다. astera 를 다시 쓰려면 사용자 Path 의 중복 항목을 지운 뒤 설정에서 다시 설치해 주세요.',
  'settings.plugins.hint': '플러그인은 Astera Host 옆에서 도는 프로그램입니다. 설치하면 이 컴퓨터에서 신뢰된 코드로 실행되고, Astera 에는 허락한 권한 안에서만 요청할 수 있습니다.',
  'settings.remote.hint': '다른 컴퓨터에서 도는 Astera(Runtime)의 Job 을 이 앱에서 봅니다. 연결은 Runtime 컴퓨터의 키를 확인한 뒤에만 이루어지고, 토큰은 이 컴퓨터에만 저장됩니다.',
  'jobs.runtime.local': '이 컴퓨터',
  'jobs.runtime.offline': '{name} 이(가) 응답하지 않습니다. 마지막으로 받은 내용입니다. Job 은 아직 돌고 있을 수 있습니다.',
  'jobs.runtime.lastSeen': '마지막 연결 {at}',
  'jobs.runtime.unregistered': '등록되지 않은 폴더',
  'jobs.runtime.optionOffline': '{name} (응답 없음)',
  'jobs.runtime.outcomeUnknown': 'Runtime 이 응답을 멈춰 이 동작이 이미 반영되었을 수 있습니다. 다시 응답하면 목록을 확인하세요.',
  'jobs.runtime.unreachable': 'Runtime 이 응답하지 않습니다. 그 컴퓨터에서는 아무것도 바뀌지 않았습니다.',
  'jobs.run.resumeFailed': '예약을 다시 시작하지 못했습니다.',
  'jobs.runtime.readOnlyReason': '읽기 전용: 이 컴퓨터는 이 Runtime 을 보기만 하도록 페어링되어 있습니다. 작업을 바꾸려면 Runtime 컴퓨터의 설정 › 원격 Runtime › 이 컴퓨터에서 전체 제어로 페어링 문자열을 만들거나 astera runtime pair --full-control 을 실행해 다시 페어링하세요.',
  'settings.mcp.hint': 'astera mcp serve 로 연결한 MCP 클라이언트가 할 수 있는 일입니다. 읽기 전용이면 Job 과 Run 을 보기만 하고, 읽기와 제어면 Job 을 만들고 실행하고 멈추고 다시 이어 가고 질문에 답할 수 있습니다.',
  // app-settings.json 이 손상되어 복구했을 때 한 번 뜨는 알림. 권한 확인은 켜진 쪽으로 복구된다
  'settings.recovered.toast':
    '설정 파일(app-settings.json)이 손상되어 설정을 기본값으로 되돌렸습니다. 손상된 파일은 ' +
    'app-settings.json.bak 에 남겨 두었습니다. 안전을 위해 권한 확인은 켜 두었습니다. ' +
    '설정 > 에이전트에서 "권한 확인 없이 에이전트 실행"을 다시 켜면 확인 없이 실행됩니다.',
  'common.cancel': '취소',
  'common.confirm': '확인',
  'common.close': '닫기',
  'common.toastDismiss': '알림 닫기',
  // worktreeErrors.ts — worktree IPC error code → user-facing message
  'worktree.error.notGitRepo': '선택한 폴더가 git 저장소가 아닙니다.',
  'worktree.error.noBase': '기본 브랜치(origin/HEAD·main·master)를 찾을 수 없어 worktree를 만들 수 없습니다.',
  'worktree.error.fetchFailed': '원격에서 기본 브랜치를 가져오지 못했습니다. 네트워크를 확인하세요.',
  'worktree.error.nameExhausted': '같은 이름의 worktree·브랜치가 너무 많습니다. 다른 이름을 지정하세요.',
  'worktree.error.invalidName': '이름에 사용할 수 있는 문자가 없습니다.',
  'worktree.error.notManaged': '이 앱이 만든 worktree가 아니라 삭제할 수 없습니다.',
  'worktree.error.dangerousPath': '안전하지 않은 경로라 삭제를 거부했습니다.',
  'worktree.error.dirty': '커밋되지 않은 변경 사항이 있어 삭제하지 않았습니다.',
  'worktree.error.orphanUnproven': '소유권을 확인할 수 없어 삭제하지 않았습니다. 수동으로 확인 후 삭제하세요.',
  'worktree.error.orphanUnverifiable': 'git이 이 폴더를 추적하지 않아 미커밋 변경 여부를 확인할 수 없습니다.',
  'worktree.error.gitAddFailed': 'git worktree 생성에 실패했습니다.',
  'worktree.error.cancelled': 'worktree 만들기를 취소했습니다. 만들던 것은 모두 되돌렸습니다.',
  'worktree.error.rollbackIncomplete': 'worktree 만들기를 되돌리지 못했습니다. 남은 폴더 {path} 와 브랜치 {branch} 를 직접 지워 주세요.',
  'worktree.error.gitRemoveFailed': 'git worktree 제거에 실패했습니다.',
  'worktree.error.unreachable': '워크트리 폴더에 닿지 못했거나 확인하지 못해 아무것도 지우지 않았습니다(네트워크 드라이브가 끊겼을 수 있습니다). 닿을 수 있게 되면 다시 시도하세요.',
  'worktree.error.linksUnverified': '워크트리 폴더 안의 링크를 모두 확인하고 걷어내지 못해 아무것도 지우지 않았습니다. 그대로 지우면 정션을 타고 폴더 밖의 파일까지 지워질 수 있습니다. 다시 시도하거나 링크를 직접 지우세요.',
  'worktree.error.locked': '워크트리가 잠겨 있어(git worktree lock) 아무것도 지우지 않았습니다. 먼저 잠금을 풀거나 강제로 지우세요.',
  'worktree.error.hasSubmodules': '워크트리에 서브모듈이 있어 아무것도 지우지 않았습니다. git 은 서브모듈이 있는 워크트리를 강제로만 지웁니다. 강제로 지우세요.',
  'worktree.error.rootUnreachable': '워크트리 폴더에 닿지 못했거나 확인하지 못해 워크트리를 만들지 않았습니다(네트워크 드라이브가 끊겼을 수 있습니다). 닿을 수 있게 되면 다시 시도하세요.',
  'worktree.error.repoUnreachable': '프로젝트 폴더에 닿지 못했거나 확인하지 못해 워크트리를 만들지 않았습니다(네트워크 드라이브가 끊겼을 수 있습니다). 닿을 수 있게 되면 다시 시도하세요.',
  'worktree.error.noGit': 'git 을 실행하지 못해 워크트리를 만들지 않았습니다(git 이 설치되어 있고 PATH 에 있는지 확인하세요).',
  'worktree.error.raw': '{detail}',
  'worktree.inUse.session': "실행 중 세션 '{title}'이(가) 이 worktree를 사용 중입니다. 세션을 먼저 닫으세요.",
  'worktree.inUse.run': "실행 중 프로세스 '{name}'이(가) 이 worktree를 사용 중입니다. 실행을 먼저 중지하세요.",
  'worktree.inUse.unknown': '이 worktree를 사용 중입니다.',
  // ROLL_MIXED_PROVIDER in sessions/manager.ts — a session-rolling constraint unrelated to worktrees, so it uses
  // session.* rather than worktree.*. The MESSAGES array in worktreeErrors.ts maps to this key
  'session.roll.mixedProvider': 'Claude와 Codex 계정을 섞어 롤링할 수 없습니다',
  // W9-J: the Worktrees page
  'worktrees.title': '워크트리',
  'common.quitConfirm.body': '창을 닫으면 Astera가 종료되고 진행 중인 세션 {count}개도 함께 종료됩니다. 계속할까요?',
  'common.quitConfirm.bodyKept':
    '창을 닫으면 Astera가 종료됩니다. 진행 중인 세션 {count}개는 계속 실행되고, 다시 열면 그대로 돌아옵니다. 계속할까요?',
  'common.quitConfirm.bodyMixed':
    '창을 닫으면 Astera가 종료됩니다. 진행 중인 세션 중 {kept}개는 계속 실행되어 다시 열면 그대로 돌아오고, {ended}개는 함께 종료됩니다. 계속할까요?',
  // App.tsx — rail, session spawn failure, placeholder, status bar usage
  'session.spawn.failed': '세션 시작 실패: {message}',
  'session.spawn.cwdMissing': '폴더를 찾을 수 없습니다: {path}. 폴더를 다시 고르세요.',
  'session.spawn.cwdUnreachable': '폴더가 제때 응답하지 않습니다: {path}. 네트워크 드라이브라면 연결을 확인하세요.',
  'session.spawn.failedWorktreeKept':
    '세션 시작 실패: {message} (worktree "{name}"는 남아 있으니 Worktrees 패널에서 삭제하세요)',
  // Rolling-resume guard hit — tells the user the tab was just focused and their chosen options were dropped
  'session.spawn.resumeLiveIgnored': '이미 실행 중인 세션입니다 — 선택한 옵션은 적용되지 않았습니다.',
  // Smart Resume took the blank slate — without this the user reads the empty window as a lost conversation
  'session.spawn.smartResume':
    '스마트 재개: 대화를 다시 싣는 대신, 지금까지의 작업 브리핑을 들려 새 세션으로 시작했습니다.',
  // The conversation was sent to the Claude background and lives on in a copy; that copy was opened
  'session.spawn.resumeFollowed': '이 대화는 background 로 옮겨진 뒤 이어진 대화가 있어서, 그 대화를 열었습니다.',
  // A Claude background session still holds the conversation; the toast's button takes it over
  'session.spawn.inBackground': '이 대화는 Claude background 세션에서 열려 있습니다. 가져오면 그 세션을 끄고 여기서 이어 갑니다.',
  'session.spawn.inBackgroundBusy':
    '이 대화는 Claude background 세션에서 지금 작업 중입니다. 가져오면 진행 중인 작업이 멈추고 여기서 이어 갑니다.',
  'session.spawn.inBackground.takeOver': '가져오기',
  // App.tsx — file editor buffer state, save, conflict, close confirmation
  'files.editor.binaryUnsupported': '바이너리 파일은 표시할 수 없습니다.',
  'files.save.failed': '저장 실패: {detail}',
  'files.reload.failed': '다시 로드 실패: {detail}',
  'files.unsaved.title': '저장하지 않은 변경',
  'files.unsaved.bodyWithTitle': "'{title}' 파일에 저장하지 않은 변경이 있습니다. 닫을까요?",
  'files.unsaved.body': '저장하지 않은 변경이 있습니다. 닫을까요?',
  'files.editor.deletedExternally': '파일이 삭제되었습니다',
  'files.editor.readOnlyReason': '읽기전용 (큰 파일 또는 바이너리)',
  'files.editor.conflictChanged': '디스크에서 변경됨',
  'files.editor.reload': '다시 로드',
  'files.editor.keepMine': '내 편집 유지',
  'files.editor.loading': '불러오는 중…',
  // App.tsx — explorer close confirmation
  'explorer.closeConfirm.body': '저장하지 않은 변경이 있습니다. 탐색기를 닫을까요?',
  'run.start.failed': '실행 실패: {detail}',
  'run.jump.notAllowed': '그 프로젝트로 갈 수 없습니다 — 앱에서 한 번 열어 본 프로젝트여야 합니다',
  'settings.info.hostRestartNow': '지금 재시작',
  'settings.info.hostRestarting': '재시작 중…',
  'settings.info.hostRestartConfirmTitle': 'Host 재시작',
  'settings.info.hostRestartUnresponsiveConfirmTitle': 'Host 끝내고 다시 시작',
  // 몇 개가 끝나는지는 앱이 자기 기록으로 센다. 답하지 않는 Host 에게 물어볼 수는 없다.
  'settings.info.hostRestartUnresponsiveConfirmBody':
    '응답하지 않는 Host 를 강제로 끝내고 새로 시작합니다. 그 Host 가 들고 있던 세션 {kept}개가 함께 끝납니다. 계속할까요?',
  'settings.info.hostRestartUnresponsiveConfirmBodyNone':
    '응답하지 않는 Host 를 강제로 끝내고 새로 시작합니다. 그 Host 가 들고 있던 것은 없습니다. 계속할까요?',
  'settings.slack.hint': '새 세션에서 “Slack 진행상황 알림”을 켜면 진행 상황을 보냅니다.',
  // Task 10 — the general settings tab's new-tab default, beside the language row
  'settings.defaultKind.title': '새 세션 기본 종류',
  'settings.defaultKind.terminal': '터미널',
  'settings.defaultKind.chat': '대화',
  'settings.defaultKind.saveFailed': '새 세션 기본 종류를 저장하지 못했습니다: {detail}',
  'update.info.downloading': '다운로드 중 {percent}%…',
  'update.tb.sourceUpdate': '업데이트 · 변경 {count}건',
  'update.tb.building': '업데이트 빌드 중… {step}',
  'update.tb.buildWaiting': '다른 무거운 작업 뒤에서 업데이트 빌드 대기 중…',
  'update.ui.restart': '다시 시작해 업데이트',
  'update.ui.mode': '자동 업데이트',
  'update.ui.mode.off': '끔',
  'update.ui.mode.notify': '알림',
  'update.ui.mode.build': '백그라운드 빌드',
  'update.ui.mode.install-when-idle': '유휴 시 설치',
  'update.ui.mode.off.hint': '스스로 확인하지 않습니다. 업데이트 확인을 누르세요.',
  'update.ui.mode.notify.hint': '30분마다 확인하고 새 변경 사항이 있으면 알려 줍니다.',
  'update.ui.mode.build.hint': '새 변경 사항을 백그라운드에서 빌드합니다. 준비되면 직접 다시 시작하세요.',
  'update.ui.mode.install-when-idle.hint': '백그라운드에서 빌드하고, 실행 중인 작업이 없으면 스스로 다시 시작합니다.',
  'update.ui.modeSaveFailed': '업데이트 방식을 저장하지 못했습니다: {detail}',
  'update.toast.installNow': '지금 설치',
  // useFileOps.ts, FileExplorer.tsx — file-operation action names (shared by the runBatch label and the menu labels)
  'files.action.delete': '삭제',
  'files.action.duplicate': '복제',
  'files.action.move': '이동',
  'files.action.copy': '복사',
  'files.action.create': '생성',
  'files.action.rename': '이름 변경',
  // useFileOps.ts — runBatch partial-failure aggregation
  'files.batch.partialFail': '{label} {total}개 중 {failed}개 실패: {shown}{more}',
  'files.batch.moreCount': ' 외 {count}건',
  // useFileOps.ts — inline edit (create/rename) failure
  'files.commit.failed': '{action} 실패: {detail}',
  // useFileOps.ts — delete confirmation modal. The undoHint wording is settled —
  // the "up to" and "over 50MB excluded" specifics have to stay (no over-promising; see the undoHint declaration comment).
  'files.delete.undoHint':
    '{mod}+Z 또는 Local History에서 복구할 수 있습니다 (최대 30일 보관 · 50MB 또는 5,000개 항목 초과는 제외).',
  'files.delete.confirmOne': "'{name}' 을(를) 삭제할까요?\n{undoHint}",
  'files.delete.confirmDirWithCount': "'{name}' 폴더와 하위 {count}개 항목을 삭제할까요?\n{undoHint}",
  'files.delete.confirmDirAll': "'{name}' 폴더와 하위 항목 전부를 삭제할까요?\n{undoHint}",
  'files.delete.confirmMany': '{shown}{more} — {total}개 항목을 삭제할까요?{dirNote}\n{undoHint}',
  'files.delete.dirNote': ' 폴더 {count}개의 하위 항목이 함께 삭제됩니다.',
  'files.delete.moreNames': ' 외 {count}개',
  // useFileOps.ts — cut/copy and paste
  'files.clipboard.cutDone': '{count}개 항목을 잘라냈습니다',
  'files.clipboard.copyDone': '{count}개 항목을 복사했습니다',
  'files.clipboard.filesFailed': '파일을 클립보드에 올리지 못해 경로만 복사됐습니다',
  'files.paste.blocked': '붙여넣기 불가: {reason}',
  'files.paste.invalidTarget': '대상이 올바르지 않습니다',
  'files.paste.empty': '붙여넣을 항목이 없습니다',
  'files.transfer.movedTo': "{count}개 항목을 '{dest}' 에 이동했습니다",
  'files.transfer.copiedTo': "{count}개 항목을 '{dest}' 에 복사했습니다",
  'files.transfer.skipped': '{count}개 항목은 건너뜀: {reason}',
  // useFileOps.ts — Ctrl+Z undo
  'files.undo.empty': '되돌릴 조작이 없습니다',
  'files.undo.changedOne': "'{name}' 이(가) 변경되었습니다",
  'files.undo.changedMany': '{shown}{more} 이(가) 변경되었습니다',
  'files.undo.blocked': '{desc} 되돌리기 불가: {detail}',
  'files.undo.partialFail': '되돌리기 {attempted}개 중 {failed}개 실패: {shown}{more}',
  'files.undo.partialMissing': '되돌리기 {total}개 중 {missing}개 실패: {shown}{more}',
  'files.undo.done': '{desc} 되돌렸습니다',
  'localHistory.restore': '복구',
  'account.signIn.button': '로그인',
  'account.status.loggedIn': '로그인됨',
  'account.status.notLoggedIn': '미로그인',
  'accounts.import': '계정 폴더 가져오기',
  'accounts.detect': '로그인된 계정 찾기',
  // AccountSelect.tsx
  'account.select.none': '(선택 안 됨)',
  // NewSessionDialog.tsx — the new-session modal
  'session.new.title': '새 세션',
  // 세션 방식 선택(Task 7) — 터미널/대화 세그먼트 컨트롤. 대화는 Host 가 proc-* 를 말해야 켜진다
  // (kindHostOld); 계정이 Codex 인지 Claude 인지는 더 이상 가리지 않는다.
  'session.kind.terminal': '터미널',
  'session.kind.chat': '대화',
  // Shared by NewSessionDialog.tsx and TerminalView.tsx — weekday button labels, weekday text in the schedule summary.
  // Index 0 = Sunday (matches the Date.getDay() convention)
  'session.sched.weekday.sun': '일',
  'session.sched.weekday.mon': '월',
  'session.sched.weekday.tue': '화',
  'session.sched.weekday.wed': '수',
  'session.sched.weekday.thu': '목',
  'session.sched.weekday.fri': '금',
  'session.sched.weekday.sat': '토',
  'session.pane.maxReached': '패널은 최대 4개까지 나눌 수 있습니다',
  'session.resume.noLoggedInAccounts': '로그인된 계정이 없습니다. 계정에 먼저 로그인하세요.',
  // Auto-resume failure toast. See the App.tsx comment for why it is a toast and not a banner —
  // for a rolling session with Slack off, this is the only path that calls a human.
  'session.toast.stalled': "'{title}' 세션이 멈춰 있습니다 — 자동 재개 실패, 확인이 필요합니다",
  // HistoryBrowser.tsx
  // 오케스트레이션이 Task 를 판정하려고 띄운 실행이라는 라벨. 사용자가 시작한 실행과 구별되지
  // 않으면 정지시켜 그 Task 를 실패시킨다(core/run/config.ts 의 RunStatus.validation)
  'run.validation.tag': '검증',
  // App.tsx runManagerApply — the text shown when the run.saveConfigs IPC throws
  'run.config.saveFailed': '저장 실패: {detail}',
  // Why Apply refused, by reason code (core/run/types.ts SaveReason); shown left of the buttons
  'run.manager.reason.INVALID_CONFIG': '{name}: 저장할 수 없는 구성입니다',
  'run.manager.reason.UNSAFE_VALUE': '{name}: 명령에 들어가는 값에 Windows 셸이 해석하는 문자(& | ^ % ! < >)가 있습니다',
  'run.manager.reason.INVALID_CWD': '{name}: 작업 폴더는 프로젝트 안이어야 합니다',
  'run.manager.reason.INVALID_PREVIEW_URL': '{name}: 미리보기 URL 은 http:// 또는 https:// 로 시작하는 주소여야 합니다',
  'run.field.members': '멤버',
  'run.panel.tab': '실행',
  'run.panel.previewFound': '{url} 이(가) 떴습니다',
  'run.panel.previewOpen': '미리보기로 열기',
  // ---- media viewer (components/MediaViewer.tsx) ----
  'media.tab.untitled': '미디어',
  'media.error.cannotOpen': '파일을 열 수 없습니다',
  'files.openFolder.notFolder': '그 폴더가 더 이상 없습니다',
  'preview.agent.stopped': '에이전트 스크립트를 중단했습니다',
  'workspace.pane.running': '실행 중: {helper}',
  'workspace.pane.launching': '앱을 시작하는 중… {seconds}초',
  'workspace.pane.idle': '대기 중 (앱은 떠 있습니다)',
  'workspace.pane.closed': '닫혔습니다',
  'workspace.pane.failed': '작업 공간에 전하지 못했습니다: {detail}',
  'workspace.pane.nothingToStop': '중단할 스크립트가 없습니다',
  'workspace.pane.nothingToClose': '닫을 작업 공간이 없습니다',
  'terminal.open.failed': '터미널 열기 실패: {detail}',
  // 프로젝트가 없을 때의 두 줄. **위 두 문구를 대신한다** — 프로젝트가 없으면 '+ 새 작업'
  // 버튼이 그려지지 않으므로(JobsView 의 hasProject, App.tsx 의 그 주석이 이유를 적었다)
  // jobs.empty.hint 의 '여기서 바로 만들 수 있습니다' 가 거짓이 된다. 무엇을 하면 되는지
  // 적는 자리가 화면에 없으면 사람은 버튼이 사라진 줄 안다
  'jobs.noProject': '열린 프로젝트가 없습니다',
  'jobs.noProject.hint': '세션을 열면 그 폴더가 이 창의 프로젝트가 되고, 그때부터 여기서 작업을 만들 수 있습니다',
  // Host 가 상태 파일의 주인이 된 뒤의 두 화면(호스트 제어면 설계 §6). 빈 사이드바로는 "아직
  // 기다리는 중" 과 "못 붙었다" 가 같아 보이고, 둘 다 "작업이 없다" 로 읽힌다.
  'jobs.host.waiting': 'Host 에 연결하는 중입니다',
  'jobs.host.unreachable': 'Host 에 연결할 수 없습니다',
  // **네 기능을 한자리에서 말한다**(판정 F35). 이 계획 전에는 넷 다 Host 없이 돌았으므로, 어느
  // 하나만 적으면 /astera-task 가 멈춘 사람은 자기 기능이 왜 죽었는지 알 길이 없다. 기능마다
  // 화면을 따로 만드는 대신 이 한 줄이 넷을 모두 이름으로 부른다.
  'jobs.host.features': '작업(Jobs), 작업 단위 추적, 에이전트 브라우저, 스마트 재개가 이 연결을 기다리고 있습니다',
  'jobs.host.retry': '설정을 바꾸거나 앱을 다시 켜면 다시 시도합니다',
  'jobs.host.reason': '사유: {reason}',
  'jobs.host.log': '자세한 기록: {path}',
  // 한도 L3: 아무것도 움직이지 않을 때 그 까닭.
  'jobs.stall.parked': 'Host 가 작업을 멈춰 둠: {reason}',
  'jobs.stall.gate.unreadable': '설정 파일을 읽을 수 없습니다. Astera 를 다시 켜면 고칩니다',
  'jobs.stall.gate.notMigrated': '설정 이전이 아직 끝나지 않았습니다. Astera 를 켜 두면 끝납니다',
  'jobs.stall.unresponsive': 'Host 가 응답하지 않아 작업이 움직이지 않습니다. 설정의 정보 탭에서 Host 를 다시 시작할 수 있습니다',
  'jobs.stall.reading': 'Host 가 아직 설정을 읽는 중이라 작업이 움직이지 않습니다',
  'jobs.run.running': '도는 중',
  'jobs.run.pause': '일시 중지',
  'jobs.run.pauseConfirmTitle': '예약 일시 중지',
  'jobs.run.pauseConfirmBody': '현재 작업 중인 모든 task가 중지되며 다시 실행 시 다음 예약 시간부터 실행됩니다.',
  'jobs.run.paused': '스케줄 일시 중지됨',
  'jobs.run.roundStopped': '중지됨',
  'jobs.run.pauseFailed': '일시 중지하지 못했습니다',
  'jobs.run.pauseRetained': 'worker-retain 으로 붙잡아 둔 세션이 있어 멈출 수 없습니다 — 먼저 놓아 주세요',
  'jobs.run.resume': '다시 실행',
  'jobs.run.coordinatorRestart': '코디네이터 다시 띄우기',
  'jobs.run.coordinatorRestartHint': '이 작업을 관리할 코디네이터 세션이 없습니다 — 눌러서 다시 띄웁니다',
  'jobs.run.coordinatorRestartFailed': '코디네이터를 다시 띄우지 못했습니다',
  'jobs.run.notStarted': '실행 대기',
  'jobs.run.notDelivered': '전달되지 않았다: {reason}',
  'jobs.new.plannerFailed': '작업은 만들었지만 플래너를 띄우지 못했습니다',
  // W8-D
  'jobs.run.overlaps': '다른 계획과 겹침',
  'jobs.run.overlapsHint': "다른 계획의 Task 가 이 파일이나 이슈를 쥐고 있다. 승인해도 안전하다: 그 Task 가 고치는 동안 이 Task 는 기다린다.",
  'jobs.run.approve': '승인 후 실행',
  'jobs.run.planning': '계획 중…',
  'jobs.run.startsByItself': '자동으로 시작',
  'jobs.run.approveHint': '이 계획을 승인하고 워커를 시작합니다',
  'jobs.run.planInvalid': '계획을 아직 승인할 수 없습니다:',
  'jobs.run.deleteMerge': '프로젝트 폴더에 병합하기',
  'jobs.run.deleteMergeHint': '워커가 워크트리에 커밋한 일을 지금 합칩니다 (워크트리 {count}개)',
  'jobs.run.deleteHide': '히스토리 목록에서 감추기',
  'jobs.run.deleteWorktrees': '워크트리 폴더 삭제 ({count}개)',
  'jobs.run.deleteWorktreesHint': '병합하지 않고 지우면 합치지 않은 커밋이 함께 사라집니다',
  'jobs.run.delete': '작업 지우기',
  'plan.talk.reject': "거절",
  'plan.talk.failed': "플래너에게 보내지 못했습니다",
  'plan.talk.rejectBody': "\"{objective}\" 계획을 거절할까요? 사유와 함께 보관되고 플래너는 종료됩니다. 보관 해제로 되돌릴 수 있습니다.",
  'plan.talk.rejectFailed': "계획을 거절하지 못했습니다",
  // W1-C plan lifecycle
  'jobs.lifecycle.rename': '이름 바꾸기',
  'jobs.lifecycle.renameFailed': '이름을 바꾸지 못했습니다',
  'jobs.lifecycle.titlePlaceholder': '비우면 목표로 이름을 정합니다',
  'jobs.lifecycle.archive': '보관',
  'jobs.lifecycle.archiveBody': '"{objective}" 을(를) 보관합니다. 목록에서 숨겨지고 새 작업을 시작하지 않습니다. 지금 도는 세션은 그대로 돕니다.\n\n보관 해제로 되돌릴 수 있습니다.',
  'jobs.lifecycle.archiveKill': '도는 세션도 닫기',
  'jobs.lifecycle.archiveKillHint': '도는 회차를 `runs stop` 처럼 멈춥니다: 워커와 코디네이터가 닫히고 회차는 일시 중지됩니다.',
  'jobs.lifecycle.archiveFailed': '보관하지 못했습니다',
  'jobs.lifecycle.unarchive': '보관 해제',
  'jobs.lifecycle.unarchiveFailed': '보관을 해제하지 못했습니다',
  'jobs.lifecycle.showArchived': '보관된 작업 보기 ({count})',
  'jobs.lifecycle.hideArchived': '보관된 작업 숨기기',
  'jobs.lifecycle.archived': '보관됨',
  'jobs.run.deleteBody': '"{objective}" 를 지웁니다 — Task {tasks}개와 이벤트 {events}개가 함께 사라지고 되돌릴 수 없습니다.\n\n아직 합쳐지지 않은 워크트리와 브랜치는 지우지 않습니다(합친 것은 병합할 때 이미 지워졌습니다 — 남은 것은 파일 탐색기의 워크트리 패널에서 지울 수 있습니다).',
  'jobs.run.deleteStopsWorkers': '도는 워커 {workers}개를 정지시킵니다. 워크트리에 있고 아직 프로젝트 폴더로 병합되지 않은 작업은 함께 사라집니다.',
  'jobs.run.deleteRetained': 'worker-retain 으로 붙잡아 둔 세션이 있어 지울 수 없습니다 — 먼저 놓아 주세요',
  'jobs.run.deleteBusy': '이 작업에 도는 워커가 있어 지울 수 없습니다 — 먼저 멈춰 주세요',
  'jobs.run.deleteFailed': '작업을 지우지 못했습니다',
  'jobs.run.deleteKeptWorktrees': '워크트리 폴더 {count}개를 남겼습니다. 커밋되지 않은 변경이 있거나 상태를 확인하지 못했습니다. 내용을 확인한 뒤 워크트리 패널에서 지우세요.',
  'jobs.run.sharedFolder': '폴더 공유',
  'jobs.run.sharedFolderHint': '다른 작업의 워커와 같은 폴더에서 돌고 있습니다 — 서로의 편집이 섞일 수 있고, 앱은 그것을 막지도 알아채지도 못합니다',
  'jobs.run.scheduled': '예약',
  'jobs.run.scheduleNext': '다음 {time}',
  'jobs.run.scheduleRuns': '{count}회 실행',
  // 회차 줄의 번호. 발화 시점에 찍힌 서수라 기록을 지워도 남은 번호가 바뀌지 않는다
  'jobs.run.scheduleOrdinal': '{n}회차',
  'jobs.run.scheduleEmpty': '대기 중',
  'jobs.run.scheduleMore': '{count}개 더 보기',
  'jobs.run.schedulePending': '실행을 누르면 예약이 시작됩니다',
  'jobs.gates.more': '외 {count}건',
  // RunDetail.tsx 의 아래 칸 — 이벤트 목록. 종류 배지는 이벤트 종류(또는 메시지 종류)가 고른다.
  // Run 을 '작업'이라 부르는 것은 위의 jobs.empty 와 같고, 그 안의 Task 는 'Task' 로 적는다 —
  // 한 목록에 두 층의 사건이 나란히 나오므로 같은 낱말이면 구분되지 않는다.
  // 이름이 timeline 으로 남는 것은 이 칸이 곧 타임라인이기 때문이다. 창을 여는 사이드바의 입구는
  // jobs.detail.open 이다 — 그 창은 이제 기록만이 아니라 의존 그래프도 담으므로 '기록' 이 아니라
  // '자세히' 다. 창 자체의 문구도 jobs.detail.* 이다
  'jobs.detail.open': '자세히',
  // NewRunModal.tsx — 사이드바의 '+ 새 작업'이 여는 Run 생성 폼의 문구. jobs.new.concurrency 는
  // 프로젝트 전체가 아니라 이 Run 하나가 동시에 열어 둘 워커 수의 상한이다 — 다른 동시 실행
  // 설정과 자리가 다르므로 섞어 쓰면 안 된다.
  'jobs.new.open': '새 작업',
  // W6-G
  'settings.usageGuard.subagentsLabel': '탭당 최대 서브에이전트 수',
  'settings.usageGuard.pauseAtLabel': '새 워커를 멈출 사용량 (%)',
  'settings.accountMaxSessions.label': '계정당 최대 세션 수',
  'settings.accountMaxSessions.hint': '한 계정이 동시에 돌리는 Astera 세션 수입니다. 비워 두면 제한이 없습니다. 시작할 때 꽉 찬 계정은 건너뜁니다.',
  'jobs.new.scheduleHint': '정한 시각마다 이 작업의 회차를 하나 만들어 돌린다',
  'jobs.new.failed': '작업을 만들지 못했습니다',
  'jobs.source.open': '소스에서',
  // W6-H delivery
  'delivery.label': '계획이 끝나면:',
  'delivery.pr': 'GitHub 에 풀 리퀘스트를 연다',
  'delivery.push': 'GitHub 의 {branch} 에 푸시한다',
  'delivery.manual': '내가 검토하도록 남겨 둔다',
  'delivery.defaultBranch': '기본 브랜치',
  'delivery.pushTo': '{remote} 의 {branch} 에 푸시한다',
  'delivery.merge': '이 컴퓨터에서 {branch} 에 병합한다',
  'delivery.off.notGit': '이 폴더는 git 저장소가 아니라서 작업은 검토하도록 남겨 둡니다',
  'delivery.off.noRemote': '원격 저장소가 없어서 푸시는 꺼져 있습니다',
  'delivery.off.notGitHub': 'GitHub 원격 저장소가 없어서 풀 리퀘스트는 꺼져 있습니다',
  'delivery.off.ghSignedOut': 'gh 에 로그인되어 있지 않아서 풀 리퀘스트는 꺼져 있습니다',
  // NewTaskModal.tsx — Task 를 짜는 동안 상세 창의 아래 칸(.detail-events)이 바뀌는 폼. deps 는
  // 이 폼이 아니라 그래프가 쥐고 있다(고르는 자리가 그래프이므로) — 그래서 이 카탈로그에는 deps
  // 자체의 값이 아니라 그것을 고르라고 안내하는 문구(depsHint)만 있다.
  'jobs.task.new': 'Task 추가',
  // T2: the new-Task form hands its description to the planner
  "jobs.task.askPlanner": "대신 플래너에게 요청",
  "jobs.task.askPlannerHint": "설명을 플래너에게 보내 계획에 맞게 작업을 넣게 합니다",
  "jobs.task.askedPlanner": "플래너에게 보냈습니다.",
  "jobs.task.aiSpec": "이 작업은 무엇을 해야 하나요?",
  "jobs.task.aiHint": "한 줄이면 됩니다. 플래너가 제목·지침·검사를 채워 계획에 넣습니다.",
  "jobs.task.addWithAi": "AI로 추가",
  "jobs.task.writeMyself": "직접 작성",
  "jobs.task.openPlanner": "플래너 열기",
  "jobs.task.noPlannerHint": "이 계획에는 플래너가 없어 직접 작성해야 합니다.",
  "jobs.task.askFailed": "플래너에게 보내지 못했습니다",
  'jobs.task.accountHint':
    '이 Task 의 워커를 띄울 계정입니다. 자동은 여유가 가장 많은 계정을 고르니, 다른 계정에서 일을 떼어 놓고 싶을 때만 계정을 지정하세요. 둘 이상 지정하면 한도에 걸렸을 때 적은 순서대로 갈아탑니다',
  // How It Works — 프로젝트 이해
  'hiw.record.regenerateFailed': '다시 만들기 실패: {detail}',
  'hiw.pane.notInProject': '이 탭의 기록을 지금 열려 있는 프로젝트에서 찾을 수 없습니다.',
  'hiw.open.complete': '완료',
  'hiw.open.completeFailed': '완료 처리하지 못했습니다: {detail}',
  'hiw.open.completeEmpty': '바뀐 것이 없어 기록하지 않았습니다.',
  'hiw.open.cancelFailed': '취소하지 못했습니다: {detail}',
  'hiw.goal.ignored': 'How It Works의 열려 있는 작업 기록을 먼저 완료처리 해주세요.',
  // chat takeover Task 10 — the mode menu's unattended-policy section and the New Session dialog's
  // matching control (P8): what a chat session does with a permission prompt nobody answers while a
  // Host holds the process as its writer.
  'chat.unattended.heading': '자리에 아무도 없을 때',
  'chat.unattended.hold': '질문을 붙잡아 둔다',
  'chat.unattended.deny60': '60초 뒤 거절한다',
  'remote.session.failed': 'Runtime 이 거절했습니다: {message}',
  'remote.session.stop': '원격에서 종료',
  'remote.session.stopTitle': '이 세션을 Runtime 에서 끝낼까요?',
  'remote.session.stopBody': '그 컴퓨터에서 돌고 있는 에이전트가 멈춥니다. 탭만 닫으면 세션은 계속 돕니다.',
  'jobs.changes.status.added': '추가',
  'jobs.changes.status.modified': '수정',
  'jobs.changes.status.deleted': '삭제',
  'jobs.changes.status.renamed': '이름 바뀜',
  'jobs.changes.binary': '바이너리',
  'plan.cat.done': '완료',
  'plan.cat.running': '실행 중',
  'plan.cat.awaiting-review': '검토 대기',
  'plan.cat.queued': '대기',
  'plan.cat.failed': '실패',
  'plan.cat.cancelled': '취소됨',
  'plan.question.failed': '답을 보내지 못했습니다.',
  'pages.plans.title': '계획',
  'pages.plans.status.checking': '최종 확인 중',
  'pages.plans.status.blocked': '막힌 Task 를 남기고 끝남',
  'pages.plan.talk': '플래너와 대화',
  'pages.plan.startAfterFailed': '계획의 시작 시점을 바꾸지 못했습니다.',
  // W3-B command bar and voice
  'jobs.run.approveConfirmBody': '"{objective}" 를 승인하고 워커를 시작할까요? 워커마다 계정의 실제 세션이고 사용량을 씁니다.',
  'command.stop.title': '계획 멈추기',
  'command.stop.body': '"{objective}" 를 멈추면 워커와 코디네이터가 닫히고 일시 중지된다. 다시 시작으로 이어 간다.',
  'command.stop.confirm': '멈추기',
  'command.stop.failed': '계획을 멈추지 못했다',
  'command.holdWorker.title': '워커 일시 중지',
  'command.holdWorker.body': '{session} 을 일시 중지할까요? 세션은 열린 채 자리를 지키고, 재개할 때까지 어떤 에이전트도 그 세션에 아무것도 보내지 않는다. 이미 도는 턴은 끊지 않는다.',
  'command.holdWorker.confirm': '일시 중지',
  'command.holdWorker.failed': '워커를 일시 중지하지 못했다',
  'command.holdWorker.releaseFailed': '워커를 재개하지 못했다',
  'jobs.hold.hold': '새 워커 시작 중지 (도는 워커는 계속한다)',
  'jobs.hold.release': '새 워커 다시 시작',
  'jobs.hold.held': '새 에이전트를 시작하지 않음',
  'jobs.hold.failed': '계획의 새 워커 시작을 멈추지 못했다',
  'jobs.hold.releaseFailed': '계획이 다시 워커를 띄우게 하지 못했다',
  // W7-F (#84)
  'shortcut.tabs.switcher': '탭 빠르게 전환',
  'tabs.close.title': '이 콘솔을 닫을까요?',
  'tabs.close.body': '끝내면 CLI가 멈춥니다. 계속 실행하면 탭만 숨겨집니다: 타일은 홈에 남고, 탭 메뉴의 최근 닫은 탭에서 다시 열 수 있습니다.',
  'tabs.close.end': '세션 끝내기',
  'tabs.close.keep': '백그라운드에서 계속 실행',
  'tabs.close.remember': '다시 묻지 않기',
  'tabs.recent.cannotResume': '"{title}"은(는) 이어서 열 수 없습니다: 대화 기록이 남지 않았습니다(Codex 세션이거나 첫 답 전에 끝난 세션).',
  'settings.group.accounts': '계정 및 사용량',
  'settings.row.slack': 'Slack',
  'settings.row.telegram': 'Telegram',
  'settings.telegram.hint':
    '@BotFather로 봇을 만들고 봇에게 아무 메시지나 보내세요. 개인 채팅이라면 채팅 ID와 사용자 ID는 본인의 숫자 Telegram ID입니다.',
  'settings.row.discord': 'Discord',
  'settings.discord.hint':
    'Discord 개발자 포털에서 봇을 만들고 Message Content 인텐트를 켜세요. 켜지 않으면 봇이 답장을 읽을 수 없습니다.',
  'settings.projects.list': '프로젝트 설정',
  'settings.projects.hint': '프로젝트마다 전달 방식, 플랜 자동 승인, 테스트 명령, 동시 에이전트 수, 리뷰 횟수, 단계 사이 재계획, 기본 계정, 줄 출처를 정합니다.',
  'settings.projects.add': '프로젝트 추가',
  'settings.projects.noAnchor': '먼저 탭을 여세요',
  'new.title': '새로 만들기',
  'plan.outcome.needsYou': '확인 필요',
  'plan.outcome.stalled': '멈춤 — 진행 없음. 계획을 열고 고치기를 누르세요',
  // T36: a plan stalled on a failed Task (plan card, Plan detail, jobActions.resolveFailed)
  'plan.outcome.stalledOnFailed': '실패한 작업을 기다리며 멈춤: {task}',
  'plan.failedWait.hint': '이 작업이 실패했고 남은 작업이 이것을 기다립니다: 다시 시도, 완료로 인정, 또는 기다리는 작업 취소',
  'plan.failedWait.retry': '다시 시도',
  'plan.failedWait.accept': '완료로 인정',
  'plan.failedWait.cancel': '기다리는 작업 취소',
  'plan.failedWait.cancelBody': '이 실패한 작업을 기다리는, 시작하지 않은 작업이 계획에서 빠집니다. 되돌릴 수 없습니다.',
  'plan.failedWait.acceptReason': '소유자가 완료로 인정함',
  'plan.failedWait.failed': '실패한 작업을 처리하지 못했습니다',
  // W9-F: orchestration panels (shell, attribution, inbox …)
  'inbox.kind.waiting': '대기 중',
} as const
