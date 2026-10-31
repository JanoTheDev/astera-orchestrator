// Korean · settings area. Which files each area serves: ../README.md.
export const settings = {
  'settings.tab.creativeHub': 'Creative Hub',
  'settings.tab.shortcuts': '단축키',
  'settings.tab.history': '히스토리',
  'settings.tab.notifications': '알림',
  'settings.tab.remote': '원격 Runtime',
  'settings.tab.plugins': '플러그인',
  // 에이전트 권한 모드
  'settings.agentPermission.label': '권한 확인 없이 에이전트 실행',
  'settings.agentPermission.hint':
    '켜면 앱이 띄우는 모든 에이전트 세션이 권한 확인 없이 실행됩니다 ' +
    '(claude 는 --dangerously-skip-permissions, codex 는 --dangerously-bypass-approvals-and-sandbox). ' +
    '기본값은 꺼짐입니다. 플랜을 맡은 에이전트는 매번 새로 만든 워크트리에서 뜨는데, 그 폴더에는 승인 이력이 없고 ' +
    '프로젝트에 쌓아 둔 허용 목록(.claude/settings.local.json)도 따라오지 않아, 끄면 에이전트가 첫 명령에서 멈춥니다. ' +
    '이미 열려 있는 세션에는 적용되지 않습니다. 새 세션부터 동작합니다.',
  'settings.agentPermission.saveFailed': '권한 모드를 저장하지 못했습니다: {detail}',
  // Work Unit 추적
  'settings.workUnit.label': '작업 단위 추적',
  'settings.workUnit.hint':
    '/astera-task 로 하려는 일을 적으면 그때부터 한 줄이 시작되고, 끝날 때까지 몇 번을 주고받든 같은 ' +
    '줄로 남습니다. git 저장소인 프로젝트에서만 작동합니다. 이미 열려 있는 세션에는 적용되지 ' +
    '않습니다. 새 세션부터 동작합니다. 켠 뒤의 대화만 봅니다. 이전 기록은 읽지 않습니다.',
  'settings.workUnit.saveFailed': '작업 단위 추적 설정을 저장하지 못했습니다: {detail}',
  // 에이전트 브라우저
  'settings.agentBrowser.label': '에이전트 브라우저',
  'settings.agentBrowser.hint':
    '켜면 세션마다 자기 미리보기 탭을 갖고, 이 프로젝트의 개발 서버를 열고 새로고침하고 콘솔 오류를 읽을 수 있습니다. ' +
    '모든 계정에 astera-browser 스킬을 설치합니다. localhost 만 열 수 있습니다. ' +
    '이미 열려 있는 세션에는 적용되지 않습니다. 새 세션부터 동작합니다.',
  'settings.agentBrowser.saveFailed': '에이전트 브라우저 설정을 저장하지 못했습니다: {detail}',
  // 에이전트 앱 작업 공간
  'settings.agentApp.label': '에이전트 앱 작업 공간',
  'settings.agentApp.hint':
    '켜면 에이전트가 이 프로젝트의 앱을 사람이 보지 않는 곳(Windows 는 숨은 데스크톱, Linux 는 가상 디스플레이, macOS 는 백그라운드)에서 띄우고 조작하고 찍을 수 있습니다. ' +
    '화면과 포인터는 건드리지 않습니다. Windows 와 macOS 에서는 클립보드를 함께 씁니다. 모든 계정에 astera-app 스킬을 설치합니다. ' +
    '이미 열려 있는 세션에는 적용되지 않습니다. 새 세션부터 동작합니다.',
  'settings.agentApp.saveFailed': '에이전트 앱 작업 공간 설정을 저장하지 못했습니다: {detail}',
  // 설명 생성 (How It Works)
  'settings.gen.label': '설명 생성 계정',
  'settings.gen.hint': '선택한 계정으로 기능 설명을 만듭니다.',
  'settings.gen.none': '선택 안 함',
  'settings.gen.model': '모델',
  'settings.gen.modelDefault': 'CLI 기본값',
  'settings.gen.effort': '추론 강도',
  'settings.gen.effortDefault': '모델 기본값',
  'settings.gen.refresh': '모델 목록 새로 고침',
  'settings.gen.loading': '모델을 묻는 중…',
  'settings.gen.listFailed': '모델 목록을 받지 못했습니다 — 직접 입력할 수 있습니다. ({detail})',
  'settings.gen.modelPlaceholder': '모델 이름을 직접 입력',
  'settings.gen.saveFailed': '설명 생성 설정을 저장하지 못했습니다: {detail}',
  // Orchestrator W1-A: role models (OrchestratorModelsSettings.tsx)
  'settings.roleModels.title': '오케스트레이션 모델',
  'settings.roleModels.hint': '플랜 세션마다 띄울 모델입니다. Task 자신의 모델이 먼저이고, 그다음 난이도, 플랜의 지정, 여기 값 순서입니다. 비워 두면 CLI 기본 모델을 씁니다.',
  'settings.roleModels.placeholder': 'CLI 기본값',
  'settings.roleModels.workerPlaceholder': '난이도에 따라, 없으면 CLI 기본값',
  'settings.roleModels.noAccounts': '계정을 추가하면 그 모델을 고를 수 있습니다.',
  'settings.roleModels.saveFailed': '오케스트레이션 모델을 저장하지 못했습니다: {detail}',
  'settings.roleModels.invalid': '"{model}" 은(는) 모델 id 가 아닙니다. opus 같은 별칭이나 claude-opus-5-5 같은 전체 id 를 쓰세요.',
  'settings.roleModels.role.coordinator': '리드 에이전트',
  'settings.roleModels.role.planner': '플래너',
  'settings.roleModels.role.worker': '에이전트',
  'settings.roleModels.role.reviewer': '검토자',
  'settings.roleModels.difficulty.light': '가벼운 Task',
  'settings.roleModels.difficulty.standard': '보통 Task',
  'settings.roleModels.difficulty.hard': '어려운 Task',
  'settings.roleModels.effort': '추론 강도',
  'settings.roleModels.effortDefault': '기본값 ({level})',
  'settings.roleModels.effortCliDefault': 'CLI 기본값',
  'settings.roleModels.effortHint': '아래는 추론 강도입니다. Task 자신의 강도가 먼저이고, 시작할 때 모델이 지원하는 단계에 맞춰 조정됩니다.',
  // ---- notifications ----
  'settings.notifications.hint':
    '데스크톱 알림입니다. 다른 세션을 보고 있거나 다른 화면을 보고 있을 때 알림을 보냅니다.',
  'settings.notifications.inputNeeded': '입력이 필요할 때',
  'settings.notifications.inputNeededHint':
    '선택지나 권한 승인을 기다리며 멈춘 상태에 알림을 보냅니다.',
  'settings.notifications.limitWaiting': '한도에 걸려 멈출 때',
  'settings.notifications.limitWaitingHint': '한도에 걸렸을 때 알림을 보냅니다.',
  'settings.notifications.accountSwitched': '계정을 전환할 때',
  'settings.notifications.accountSwitchedHint': '계정을 전환할 때 알림을 보냅니다.',
  'settings.notifications.orchestration': '오케스트레이션 소식',
  'settings.notifications.orchestrationHint': 'Task 가 실패하거나 계획이 끝나거나, 질문이나 계획이 사용자를 기다릴 때, 그리고 주기 요약을 보냅니다. 한꺼번에 몰리면 미뤄 두었다가 다음 요약에서 셉니다.',
  'settings.notifications.saveFailed': '알림 설정을 저장하지 못했습니다: {detail}',
  'common.or': '또는',
  // App.tsx — settings modal Info/Slack/Worktree tabs, CLI-not-found screen
  'settings.info.appName': '앱 이름',
  'settings.info.version': '버전',
  'settings.info.registeredAccounts': '등록 계정',
  'settings.info.update': '업데이트',
  'settings.info.host': '백그라운드 서비스',
  'settings.info.hostConnected': '연결됨 · 규약 {protocol} · {uptime} 전부터',
  // Appended to hostConnected, and **only after the Host answers what it holds** — until then the
  // row is the connection facts alone. This row exists to answer "does my work survive if I close
  // this?", so it names all four kinds the Host can be holding: a run's pty outlives the app just
  // as a session's and a terminal's do (`RunManager.stopAppOwned`), and a row that left runs out
  // told someone whose work is a long build that none of it was protected.
  //
  // The four figures are separated by commas, not the ' · ' the connected row joins its own parts
  // with: nested inside that row, the same separator made one clause read as four.
  //
  // es/ja have no row of their own and reach this key's English through the fallback (see `t`); they
  // still want real translations.
  'settings.info.hostHolding': '세션 {sessions}개, 대화 {chats}개, 터미널 {terminals}개, 실행 {runs}개 유지 중',
  // The Host outlived an update and still runs the previous version. Replaced on its own the first
  // moment it holds nothing; the button is for not waiting (host-replacement design §6).
  'settings.info.hostOutdated': '백그라운드 서비스 {host} · 앱 {app} — 모든 세션을 종료하면 자동으로 새 버전으로 업데이트 됩니다. 지금 재시작 버튼으로 바로 업데이트도 가능합니다.',
  'settings.info.hostNotConnected': '연결 안 됨',
  'settings.info.hostNotConnectedWhy': '연결 안 됨 · {detail}',
  // 답을 멈춘 Host. 연결이 끊긴 것과 다르다 — 끊긴 연결은 다시 붙지만 이쪽은 스스로 풀리지 않는다.
  // 그래서 이 줄은 상태만 말하지 않고 지금 무슨 일이 벌어지는지(새 세션은 앱 안에서 열린다)와
  // 그 대가(앱을 끄면 함께 끝난다)를 함께 말한다. 2026-09-22 에 사람이 본 것은 "연결 안 됨" 한 줄뿐이었다.
  'settings.info.hostUnresponsive': '응답 없음 · {detail}',
  // 버튼을 가리키는 말은 넣지 않는다. 그 버튼이 Host 를 못 끝내는 경우가 있고(실행 파일이 우리 것이
  // 아니면 손대지 않는다), 그때 이 줄이 "버튼으로 끝낼 수 있습니다" 라고 말하면 바로 윗줄과 모순된다.
  // 버튼은 바로 옆에 있으므로 가리킬 필요도 없다.
  'settings.info.hostUnresponsiveWhat': '새 세션은 앱 안에서 열리고 있습니다. 그 세션들은 앱을 끄면 함께 끝납니다.',
  // 런타임 파일이 사라진 Host. 지금은 멀쩡해 보여도 다음 세션에서 멎는다.
  'settings.info.hostRuntimeIncomplete': '백그라운드 서비스가 쓰는 파일 일부가 사라졌습니다. 이대로 두면 다음 세션에서 응답이 멈춥니다. 유지 중인 것이 없어지면 자동으로 고쳐지고, 지금 재시작해도 됩니다.',
  // 오래된 Host 옆의 "지금 재시작" 이 무엇을 하는지 한 줄로 (T15).
  'settings.info.hostRestartHint': '지금 재시작하면 새 시작을 보류하고, 작업 중인 Task 가 안전한 지점에 이르기를 기다린 뒤 모든 세션을 새 Host 로 넘깁니다.',
  'settings.worktree.createLocation': 'worktree 생성 위치',
  'settings.worktree.change': '변경…',
  'settings.worktree.hint':
    '새 worktree가 이 폴더 아래 <repo명>/<이름>으로 생성됩니다. 기존 worktree는 이동하지 않습니다.',
  'settings.history.hiddenProjects': '숨긴 프로젝트',
  'settings.history.unhide': '해제',
  'settings.history.empty': '숨긴 프로젝트가 없습니다.',
  // 목록이 한 페이지를 넘길 때만 붙는 검색·페이지 이동. 전체 개수는 검색으로 걸러도 그대로 둔다 —
  // 검색 결과만 보이면 몇 개를 숨겨 뒀는지 알 길이 없다
  'settings.history.search': '경로 검색…',
  'settings.history.noMatch': '검색과 일치하는 항목이 없습니다.',
  'settings.history.total': '전체 {count}개',
  'settings.history.prevPage': '이전 페이지',
  'settings.history.nextPage': '다음 페이지',
  // 기록 삭제 — 되돌릴 수 없는 쪽이라 무엇이 남는지까지 문구에 적는다
  'settings.history.selectAll': '전체 선택',
  'settings.history.deleteSelected': '기록 삭제 ({count})',
  'settings.history.deleteTitle': '선택한 프로젝트의 기록을 지울까요?',
  'settings.history.deleteBody':
    '대화 기록 {count}개를 휴지통으로 보냅니다. 프로젝트 폴더와 그 안의 파일은 지우지 않습니다.\n\n{list}',
  'settings.history.deleteConfirm': '휴지통으로 보내기',
  'settings.history.deleteDone': '기록 {count}개를 휴지통으로 보냈습니다.',
  'settings.history.deleteBusy': '{name} 이(가) 실행 중이라 {count}개를 건너뛰었습니다.',
  'settings.history.deleteFailed': '{count}개는 지우지 못했습니다.',
  // ThemeSettings.tsx — the theme card grid
  'settings.theme.label': '테마',
  'settings.theme.hint':
    'Night·Dusk·Day 는 색만 바뀝니다. 시스템은 OS 를 따릅니다(라이트 → Day, 다크 → Night). 터미널 폰트는 아래에서 따로 고릅니다.',
  'settings.theme.system': '시스템',
  'settings.theme.saveFailed': '테마 저장 실패: {detail}',
  // ResumeStrategySettings.tsx — the two-way resume strategy picker
  'settings.resumeStrategy.label': '세션 재개 방식',
  'settings.resumeStrategy.smart.label': '스마트 재개',
  'settings.resumeStrategy.smart.hint': '간결한 체크포인트만으로 대화를 이어갑니다. 에이전트가 작업 중 남긴 인계 메모가 있으면 함께 전달합니다.',
  'settings.resumeStrategy.original.label': '원래 세션 재개',
  'settings.resumeStrategy.original.hint': '기존 Resume 방식으로 대화를 이어갑니다.',
  'settings.resumeStrategy.saveFailed': '재개 방식을 저장하지 못했습니다: {detail}',
  'settings.jobContinuity.label': '작업 이어가기',
  'settings.jobContinuity.hint':
    '앱이 죽거나 다시 시작해도 작업을 복구할 수 있게 유지합니다. ' +
    '작업 상태를 디스크에 남기고, 에이전트의 원래 세션을 되살리며, 필요할 때 스마트 재개를 씁니다.',
  'settings.jobContinuity.smartResumeTurnedOn':
    '작업 이어가기를 켰습니다. 완전한 자동 복구를 위해 스마트 재개도 함께 켰습니다.',
  'settings.jobContinuity.turnOffSmartResume.title': '스마트 재개를 끌까요?',
  'settings.jobContinuity.turnOffSmartResume.body':
    '작업 이어가기는 켜진 채로 남지만, 원래의 Claude Code 나 Codex 세션을 되살릴 수 없으면 작업이 멈출 수 있습니다.',
  'settings.jobContinuity.turnOffSmartResume.confirm': '끄기',
  'settings.jobContinuity.saveFailed': '작업 이어가기 설정을 저장하지 못했습니다: {detail}',
  'settings.defaultKind.hint':
    '새 세션과 이어하기 창이 이 종류로 열립니다. 창 안에서 바꾸면 그 세션에만 적용됩니다.',
  // TerminalFontSettings.tsx — the terminal font picker rows
  'settings.font.latin': '터미널 영문 폰트',
  'settings.font.hangul': '터미널 한글 폰트',
  'settings.font.system': '시스템 기본',
  'settings.font.notInstalled': '설치되지 않음',
  'settings.font.sample': 'AaBb 한글 123',
  'settings.font.hangulShadowed':
    '선택한 영문 폰트가 한글도 그리기 때문에 한글 폰트 설정은 적용되지 않습니다.',
  'settings.font.listFailed': '설치된 폰트 목록을 가져오지 못했습니다: {detail}',
  'settings.font.saveFailed': '폰트 설정을 저장하지 못했습니다: {detail}',
  'settings.font.checkingHangul': '설치된 폰트 확인 중…',
  'settings.font.loadingList': '설치된 폰트 읽는 중…',
  'update.info.restartInstallVersion': '재시작하여 v{version} 설치',
  'update.info.checking': '확인 중…',
  'update.info.checkButton': '업데이트 확인',
  'update.info.upToDateAt': '현재 최신 버전입니다 ({time} 확인)',
  // 'available' means "found", not "downloading" — the download announces itself through the
  // 'downloading' state, which has wording of its own.
  'update.info.available': '새 버전 {version} 있음',
  'update.info.downloadVersion': '{version} 다운로드',
  'update.info.checkFailed': '확인 실패',
  // macOS 전용. Squirrel 이 받은 빌드를 거부해 재시작으로는 설치되지 않는 상태 — 왜 되돌릴 수
  // 없는 거부인지는 src/main/manualInstall.ts 에 있다. 이유를 한 줄 붙이는 것이 핵심이다:
  // 예전에는 이 실패가 로그에만 남아서, 사람 눈에는 버튼이 죽은 것과 구별되지 않았다.
  'update.info.manualInstallVersion': 'v{version} 직접 설치',
  'update.info.manualWhy': '이 빌드는 자동 설치가 되지 않아 직접 옮겨야 합니다',
  'update.info.manualOnly': '이 빌드는 자동 업데이트를 하지 않습니다: 소스를 받아 다시 빌드하세요',
  'update.ui.build': '빌드',
  'update.ui.checkedAt': '{time} 확인',
  'update.ui.upToDate': '최신 상태',
  'update.ui.changes': '새 변경 사항: {count}',
  'update.ui.ready': '업데이트 빌드 완료 — 변경 사항: {count}',
  'update.ui.buildNow': '지금 빌드',
  'update.ui.lastError': '마지막 오류: {message}',
  'update.ui.showChanges': '변경 사항 보기 ({count})',
  'update.ui.hideChanges': '변경 사항 접기',
  'update.ui.moreChanges': '…그 외 {count}개',
  // App.tsx — settings modal Shortcuts tab (the SHORTCUTS array; a module-level constant, so translated at render time)
  'shortcut.group.terminal': '터미널',
  'shortcut.terminal.newline': '줄바꿈',
  'shortcut.terminal.copyOrInterrupt': '선택 복사 · 없으면 중단',
  'shortcut.paste': '붙여넣기',
  'shortcut.group.sessionTab': '세션 탭',
  'shortcut.gesture.tabDrag': '탭 드래그',
  'shortcut.sessionTab.reorder': '순서 변경',
  'shortcut.group.pane': '패널',
  // ShortcutSettings.tsx — the editable shortcut list
  'shortcut.group.editable': '변경 가능',
  'shortcut.edit': '변경',
  'shortcut.resetOne': '기본값',
  'shortcut.capturing': '키를 누르세요 (Esc 취소)',
  'shortcut.unbound': '없음',
  'shortcut.conflictWith': '{key}는 이미 "{action}"에 쓰입니다',
  'shortcut.riskTitle': '{key}를 앱 단축키로 지정',
  'shortcut.riskConfirm': '그래도 지정',
  'shortcut.pane.dragSplit': '가장자리로 분할 · 가운데로 이동',
  'shortcut.group.explorer': '파일 탐색기',
  'shortcut.explorer.saveFile': '파일 저장',
  'shortcut.explorer.rename': '이름 변경',
  'shortcut.explorer.delete': '삭제',
  'shortcut.explorer.selectAll': '전체 선택',
  'shortcut.explorer.cut': '잘라내기',
  'shortcut.explorer.copy': '복사',
  'shortcut.gesture.itemDrag': '항목 드래그',
  'shortcut.explorer.move': '이동 · {mod} 누르면 복사',
  'shortcut.explorer.undo': '되돌리기',
  'settings.maxWorkers.label': '모든 플랜을 합친 최대 에이전트 수',
  'settings.maxWorkers.hint': '최대 100. 비워 두면 이 기기의 추천값을 씁니다. 한도에 닿으면 우선순위가 높은 플랜부터 빈자리를 받고, 같으면 번갈아 받습니다.',
  // Machine-aware worker cap: the recommendation for this machine and the warning above it
  'settings.maxWorkers.recommended': '이 기기 추천: {count}개 (메모리 {memory} GB, 코어 {cores}개)',
  'settings.maxWorkers.overRecommended': '이 기기가 측정된 메모리로 감당하는 약 {count}개를 넘었습니다(에이전트당 {memory} GB). Astera 는 무거운 작업을 대기시키고 압박이 심하면 에이전트를 줄입니다.',
  'settings.maxWorkers.saveFailed': '에이전트 한도를 저장하지 못했습니다: {detail}',
  'settings.minWorkers.label': '메모리 압박 시 최소 에이전트 수',
  'settings.minWorkers.hint': '메모리가 부족해지면 Astera 는 에이전트를 조금씩 줄이되 이 값 아래로는 내리지 않습니다.',
  'settings.minWorkers.default': '{count}개 = {person}개의 절반',
  'settings.minWorkers.saveFailed': '최소 에이전트 수를 저장하지 못했습니다: {detail}',
  'settings.heavyJobs.label': '동시에 실행할 무거운 작업 수',
  'settings.heavyJobs.hint': '전체 테스트, Electron, dist 빌드, Task 검사를 기기 전체에서 동시에 몇 개까지 돌릴지 정합니다. 비워 두면 자동이며, 남은 메모리에서 그때그때 정합니다. 숫자를 넣으면 그 값을 그대로 씁니다.',
  'settings.heavyJobs.auto': '자동 (지금 여유 메모리 기준 {count})',
  'settings.heavyJobs.saveFailed': '무거운 작업 한도를 저장하지 못했습니다: {detail}',
  'settings.activityDigest.label': '활동 요약 주기(분)',
  'settings.activityDigest.hint': '끝났거나 실패했거나 기다리는 일의 요약을 데스크톱과 Slack 에 보내는 주기입니다. 일이 있었을 때만 보냅니다. 0 이면 보내지 않습니다.',
  'settings.activityDigest.saveFailed': '요약 주기를 저장하지 못했습니다: {detail}',
  'settings.freshCoordinator.label': '컨텍스트 사용률로 리드 에이전트 교체(%)',
  'settings.freshCoordinator.hint': '플랜마다 리드 에이전트가 있습니다: 플랜을 이끄는 세션입니다. 리드 에이전트가 컨텍스트 창을 이 비율만큼 쓰면 Astera 가 같은 계정과 모델의 새 세션으로 바꾸고, 플랜 상태를 알려 줍니다. 플랜이 다음 단계로 넘어갈 때도 교체합니다. 0 이면 컨텍스트 확인을 끕니다.',
  'settings.freshCoordinator.saveFailed': '새 리드 에이전트 설정을 저장하지 못했습니다: {detail}',
  'settings.stallWatch.label': '멈춘 플랜 감시',
  'settings.stallWatch.hint': '돌고 있는 플랜을 30초마다 확인합니다. 슬롯이 비었는데 2분 넘게 시작되지 않은 준비된 Task, 일 없이 바쁘기만 한 리드 에이전트, 플랜 브랜치에 합쳐지지 않은 완료 Task, 열리지 않은 드래프트 PR 을 찾아 리드 에이전트에게 알리거나 직접 고칩니다. 하는 일마다 피드에 한 줄을 남기고, 취소하거나 main 에 합치는 일은 하지 않습니다.',
  'settings.stallWatch.saveFailed': '멈춘 플랜 감시 설정을 저장하지 못했습니다: {detail}',
  'settings.startAtLogin.label': '로그인 시 Astera 시작',
  'settings.startAtLogin.hint': '로그인할 때 Astera를 백그라운드에서 시작해, 충돌이나 재시작으로 중단된 플랜이 창을 열기 전에 이어서 진행되게 합니다. Linux 전용.',
  'settings.startAtLogin.saveFailed': '로그인 시 시작 설정을 저장하지 못했습니다: {detail}',
  'settings.autoAnswer.label': '질문에 자동으로 답하기',
  'settings.autoAnswer.hint': '안전하게 답할 수 있는 플랜의 질문에는 Astera 가 직접 답합니다. 아는 사실(Task 가 합쳐졌는지, 단계가 끝났는지)로 먼저 답하고, 아니면 질문한 쪽의 권장안이나 안전한 기본값(보류, 대기, 한 번 재시도, 검사 건너뛰기)으로 답합니다. 답마다 피드에 한 줄을 남깁니다. 작업 삭제, 기본 브랜치로의 푸시나 병합, 돈, 자격 증명, 권한은 언제나 당신에게 갑니다.',
  'settings.autoAnswer.saveFailed': '자동 답변 설정을 저장하지 못했습니다: {detail}',
  'settings.alertSound.label': '내가 필요할 때 알림음',
  'settings.alertSound.hint': '권한 요청, 질문, 에스컬레이션, 답을 기다리는 플랜 질문 알림과 함께 짧은 알림음을 냅니다. 5초에 한 번까지입니다.',
  'settings.alertSound.saveFailed': '알림음 설정을 저장하지 못했습니다: {detail}',
  'settings.voice.title': '음성 명령 (로컬 whisper.cpp)',
  'settings.voice.hint': '명령 창의 누르고 말하기는 이 컴퓨터의 whisper.cpp 가 받아쓴다. 소리는 이 컴퓨터를 떠나지 않고 아무것도 내려받지 않는다: whisper.cpp 를 빌드하고 모델을 직접 받은 뒤 두 절대 경로를 여기에 적으세요.',
  'settings.voice.binary': 'whisper.cpp 실행 파일',
  'settings.voice.model': '모델 파일',
  'settings.voice.notAbsolute': '절대 경로를 쓰세요',
  'settings.voice.saveFailed': '음성 설정을 저장하지 못했다: {detail}',
  'settings.autoCloseTabs.label': '끝난 플랜의 탭 자동으로 닫기',
  'settings.autoCloseTabs.hint': '플랜이 끝나거나 보관되면 끝난 세션 탭을 닫고, 다시 계획하면 이전 플래너 탭을 닫습니다. 기록은 History와 워크스페이스 트리에 남습니다. 플랜에 속하지 않은 세션의 탭은 직접 닫을 때까지 남습니다.',
  'settings.autoCloseTabs.saveFailed': '탭 자동 닫기 설정을 저장하지 못했습니다: {detail}',
  // W9-I: tab summaries
  'settings.tabSummaries.label': '탭이 끝나면 요약하기',
  'settings.tabSummaries.hint': '탭이 끝나면 Astera가 짧은 카드를 씁니다: 한 일, 파일, 검사와 리뷰, 그리고 리드 에이전트 모델이 쓴 두세 문장. 카드는 Task 보드, History, 플랜 개요에 보입니다.',
  'settings.tabSummaries.saveFailed': '탭 요약 설정을 저장하지 못했습니다: {detail}',
  // W9-E settings page
  'settings.group.general': '일반',
  'settings.group.agents': '에이전트',
  'settings.group.projects': '프로젝트',
  'settings.group.integrations': '연동',
  'settings.group.notifications': '알림',
  'settings.group.advanced': '고급',
  'settings.basic.advancedMode.label': '고급 모드',
  'settings.basic.advancedMode.hint': '모든 설정과 계획의 그래프·저널 같은 기술적인 부분을 보여 줍니다.',
  'settings.basic.showAdvanced': '고급 설정 보기',
  'settings.basic.hideAdvanced': '고급 설정 숨기기',
  'settings.search.placeholder': '설정 검색',
  'settings.search.empty': '"{query}"에 맞는 설정이 없습니다',
  'settings.back': '뒤로',
  // W11: 단축키 표의 검색과 열 이름, Slack·Telegram 카드의 상태 칩
  'settings.shortcuts.search': '단축키 검색',
  'settings.shortcuts.empty': '"{query}"에 맞는 단축키가 없습니다',
  'settings.shortcuts.action': '동작',
  'settings.shortcuts.keys': '단축키',
  'settings.row.github': 'GitHub',
  'settings.row.cli': 'CLI (astera 명령)',
  'settings.row.mcp': 'MCP',
  'settings.row.cliVersions': 'Claude Code · Codex CLI',
  'onboarding.settings.replay': '온보딩 다시 보기',
  'onboarding.settings.replayHint': '설정 안내를 처음부터 다시 봅니다. 설정은 그대로 유지됩니다.',
  'onboarding.settings.replayButton': '보기',
  'settings.worktree.tooltip': 'worktree 는 자기 브랜치를 가진 프로젝트 폴더의 별도 사본입니다. 에이전트가 당신의 파일을 건드리지 않고 작업할 수 있습니다.',
  'settings.search.emptyTitle': '찾은 설정이 없습니다',
  // MCP·스킬 찾기와 사용자 지정 지시
  'settings.row.finder': 'MCP·스킬 찾기',
  'settings.finder.hint': 'MCP 레지스트리와 GitHub 스킬 저장소를 검색해, 서버와 스킬을 Claude·Codex 계정에 설치합니다.',
  'settings.row.instructions': '사용자 지정 지시',
  'settings.instructions.hint': 'Astera 가 에이전트 종류별로 프롬프트 끝에 덧붙이는 글입니다. 기본 내용을 바꾸지는 않습니다.',
  'settings.instructions.role': '역할',
  'settings.instructions.role.session': '모든 세션',
  'settings.instructions.role.planner': '플래너',
  'settings.instructions.role.coordinator': '코디네이터',
  'settings.instructions.role.worker': '워커',
  'settings.instructions.role.reviewer': '리뷰어',
  'settings.instructions.isSet': '설정됨',
  'settings.instructions.label': '{role} 지시',
  'settings.instructions.placeholder': '이 에이전트가 늘 지켰으면 하는 것을 적으세요.',
  'settings.instructions.bytes': '{n} / {max} 바이트',
  'settings.instructions.tooLong': '너무 깁니다: 최대 {max} 바이트',
  'settings.instructions.unsaved': '저장 안 됨',
  'settings.instructions.save': '저장',
  'settings.instructions.reset': '초기화',
  'settings.instructions.resetConfirm': '{role} 지시를 지울까요?',
  'settings.instructions.resetBody': '이 역할의 프롬프트에 더는 아무것도 덧붙이지 않습니다.',
  'settings.instructions.resetDone': '{role} 지시를 지웠습니다.',
  'settings.instructions.saved': '{role} 지시를 저장했습니다. 새로 시작하는 에이전트부터 적용됩니다.',
  'settings.instructions.saveFailed': '지시를 저장하지 못했습니다: {detail}',
  'settings.instructions.loadFailed': '지시를 읽지 못했습니다: {detail}',
  'settings.instructions.discardTitle': '저장하지 않은 변경을 버릴까요?',
  'settings.instructions.discardBody': '다른 역할로 바꾸면 이 역할에 적은 내용이 사라집니다.',
  'settings.instructions.preview': '기본 내용 (읽기 전용)',
  'settings.instructions.previewHint': 'Astera 가 이 역할에 쓰는 내용의 예시입니다. 당신의 글은 그 뒤에 붙습니다.',
  'settings.instructions.previewFailed': '기본 내용을 읽지 못했습니다: {detail}',
  // T6: Astera 가 스스로 낮춘 한도
  'settings.autoLimit.lowered': 'Astera 가 {date}에 이 값을 {count}(으)로 낮췄습니다: {detail}. 새 시작만 막고, 실행 중인 에이전트는 계속 돕니다.',
  'settings.autoLimit.backByItself': '기기가 안정되면 저절로 다시 올라갑니다.',
  'settings.autoLimit.staysUntilRestored': '직접 복원할 때까지 유지됩니다.',
  'settings.autoLimit.effective': '지금은 내 한도 {person}개 중 최대 {count}개만 실행 중입니다: {date}에 Astera 가 낮췄습니다 - {detail}.',
  'settings.autoLimit.restoreTo': '{count}개로 지금 복원',
  'settings.autoLimit.restore': '내 한도로 복원',
  'settings.autoLimit.restoreFailed': '한도를 복원하지 못했습니다: {detail}',
  'settings.autoLimit.checksWait': '기기가 안정될 때까지 모든 검사가 무거운 작업 자리를 기다립니다.',
  'settings.autoLimit.crashToast': '같은 일이 반복되지 않도록 Astera 가 충돌 뒤 한도를 낮췄습니다',
  'settings.autoLimit.openSettings': '설정 열기',
} as const
