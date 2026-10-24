// Korean · agents area. Which files each area serves: ../README.md.
export const agents = {
  // W9-H Agents page
  'wall.plans.all': '모든 플랜',
  'wall.plans.none': '플랜 없음',
  'wall.state.permission': '권한',
  'wall.state.question': '질문',
  'wall.state.gate': '나를 기다림',
  'wall.state.working': '작업 중',
  'wall.state.idle': '대기',
  'wall.state.finished': '끝남',
  'wall.end.title': '{name}을(를) 끝낼까요?',
  'wall.end.body': '이 콘솔은 아직 실행 중입니다. 끝내면 프로세스가 멈춥니다.',
  'wall.end.confirm': '세션 끝내기',
  'session.placeholder.start': '+ 새 세션으로 시작하세요',
  // App.tsx — run console resizer, start failure
  'run.resizeConsole': '콘솔 크기 조절',
  // WorkbenchTabs.tsx — the dirty marker on a file tab
  'explorer.tab.unsaved': '저장 안 됨',
  // WorkbenchTabs.tsx
  'session.tab.rollTooltip': '롤링: {chain}',
  // TerminalView.tsx — only the rolling banner and the loading/exit overlays the renderer draws (main's direct PTY
  // writes are separate and handled elsewhere)
  'session.terminal.rollSwitching': "'{label}'(으)로 이어가는 중…",
  'session.terminal.trustAccepting': '폴더 신뢰 자동 수락 중…',
  'session.terminal.weeklyLimitWaiting': '주간 한도 소진 — {time} 자동 재개',
  'session.terminal.limitWaiting': '한도 도달 — {time} 자동 재개',
  // Slice 2 of the Astera Host: a codex rolling chain the app took back from the Host. It is
  // deliberately not asked whether the account was already blocked (CodexRollingCoordinator.register
  // says why), so if it came back blocked it stops until codex writes its next record — which used
  // to be visible only in rolling.log. **No time is named**, unlike the two rows above: nothing is
  // scheduled, and there is nothing to name.
  //
  // es/ja have no row of their own and reach this key's English through the fallback (see `t`); they
  // still want real translations.
  'session.terminal.rollAdopted':
    '재시작 후 이어받아 이 계정의 한도 상태를 모릅니다. Codex가 사용량을 다시 기록하면 그때 계정을 전환합니다',
  'session.terminal.loadingContent': '내용 불러오는 중…',
  'session.terminal.sizedRemote': '원격 컴퓨터의 창 크기로 표시 중입니다. 입력하면 이 창 크기로 바뀝니다.',
  'session.terminal.restart': '다시 시작',
  'session.terminal.schedNextRun': ' · 다음 실행 {time}',
  'session.terminal.schedDisable': '끄기',
  'run.panel.empty': '아직 실행한 것이 없습니다. 툴바의 실행을 눌러 실행 구성을 시작하세요.',
  'run.panel.stopping': '정지 중…',
  'run.panel.close': '실행 닫기',
  'run.panel.openPreview': '{url} 미리보기로 열기',
  'conversation.sentFile.open': '{name} 열기',
  // ---- preview ----
  'preview.tab.untitled': '미리보기',
  'preview.agent.tab': '에이전트',
  'preview.agent.running': '에이전트가 이 페이지를 조작하고 있습니다',
  // 에이전트 앱 작업 공간 미러 탭
  'workspace.tab.tag': '앱',
  'workspace.tab.running': '에이전트가 보이지 않는 데스크톱에서 앱을 조작하고 있습니다',
  // ToolRow.tsx / PendingBanner.tsx (components/conversation/) — the tool row's verb, the collapsed
  // group's per-kind counts, and the banner that says a decision is waiting in the terminal.
  'conversation.verb.read': '읽음',
  'conversation.verb.find': '찾음',
  'conversation.verb.edit': '고침',
  'conversation.verb.create': '만듦',
  'conversation.verb.run': '돌림',
  'conversation.verb.running': '실행 중',
  'conversation.outcome.failed': '실패',
  'conversation.group.read': '읽기',
  'conversation.group.find': '찾기',
  'conversation.group.edit': '수정',
  'conversation.group.create': '작성',
  'conversation.group.run': '실행',
  'conversation.pending.terminal': '터미널로 이동',
  'conversation.ask.title': 'Claude 가 묻습니다',
  'conversation.ask.other': '직접 입력',
  'conversation.ask.otherPlaceholder': '여기에 입력합니다.',
  'conversation.ask.submit': '답변 보내기',
  'conversation.ask.answering': '보내는 중입니다.',
  'conversation.running.thinking': '생각 중',
  'conversation.running.working': '실행 중',
  'conversation.exited.title': '이 세션은 종료되었습니다',
  // 터미널은 언제나 종료 코드를 보여 줬고 대화 창은 보여 주지 않았다(설계 D2). 코드만으로는 아무것도
  // 말해 주지 않으므로 프로세스가 stderr 에 남긴 첫 줄을 같이 싣는다 — 전문은 접어 둔다.
  'conversation.exited.detail': '자세히',
  'conversation.exited.restart': '다시 시작',
  // design §4 F5의 확인 창 다섯 문단. S1(한두 줄)의 예외다 — 사람이 대신할 수 없는 판단이라 사실을
  // 빼면 버튼만 남는다. whatBlocked 뒤에 CLI 가 stderr 에 남긴 첫 줄(ChatState.error)이 ": <줄>" 로
  // 붙는데, 그 줄 자체는 컴포넌트가 붙인다(없으면 콜론째 생략 — fix round 1 / Important 4) — 카탈로그
  // 문구 자체는 그 줄 없이도 문장이 끝난다.
  'conversation.exited.bypassConfirm.title': '이 폴더의 toolchain 설정을 건너뛰고 다시 시도할까요?',
  'conversation.exited.bypassConfirm.whatBlockedLabel': '무엇이 막았나',
  'conversation.exited.bypassConfirm.whatBlocked':
    'CLI 가 아니라 PATH 앞의 도구 버전 관리자(Volta)가 실행을 거절했습니다. 이 폴더의 package.json 을 읽어 어느 버전을 쓸지 정해야 하는데, 그 파일을 읽지 못했습니다',
  // fix round 1 / Important 4: VOLTA_HOME 만 맞았을 때 쓰는 문구. Volta 가 이 기기에 설치돼 있다는
  // 것은 확실하지만, 그것이 *이* CLI 를 막았다는 확증은 아니다 — Volta 는 Node 를 관리하고 있고
  // codex 는 백신이 막은 별개의 설치일 수 있다. 그래서 "거절했습니다"라는 확정 서술을 쓰지 않는다.
  'conversation.exited.bypassConfirm.whatBlockedSoft':
    '이 CLI 자신이 아니라, 이 기기에 설치된 도구 버전 관리자(Volta)가 원인일 수 있습니다. Volta 가 관리하는 도구라면 PATH 앞에서 이 폴더의 package.json 을 읽어 버전을 정하려다 실행을 거절했을 수 있습니다',
  'conversation.exited.bypassConfirm.ifSkippedLabel': '건너뛰면',
  'conversation.exited.bypassConfirm.ifSkipped': '버전 판단을 생략하고 기본으로 잡히는 CLI 를 그대로 실행합니다. 세션은 뜹니다.',
  'conversation.exited.bypassConfirm.givesUpLabel': '무엇을 포기하나',
  // 마지막 문장(롤 승계)은 "얼마나 / 무엇이 바뀌나" 절이 지고 있던 것이다. 그 절을 통째로 뺐을 때
  // 같이 사라졌는데, 승계는 사람이 보는 데서 일어나지 않으므로 어디에도 안 적히면 아무도 모른다.
  // 그래서 문단 하나가 아니라 문장 하나로, 대가를 말하는 자리에 붙였다 — 승계되는 것이 바로 이 대가다.
  'conversation.exited.bypassConfirm.givesUp':
    '이 프로젝트에 핀해 둔 도구 버전입니다. 이 세션뿐 아니라 이 세션이 실행하는 모든 명령(에이전트가 돌리는 npm test, npm run build, node …)이 핀된 버전이 아니라 기본 버전으로 돕니다. 같은 명령이 당신 터미널에서와 다른 결과를 낼 수 있습니다. 사용량 한도로 다른 계정에 넘어갈 때 이어받는 세션도 같습니다.',
  'conversation.exited.bypassConfirm.properFixLabel': '제대로 된 해결',
  'conversation.exited.bypassConfirm.properFix': 'package.json 을 고치면 이 창은 다시 뜨지 않습니다.',
  'conversation.exited.bypassConfirm.confirm': '건너뛰고 다시 시도',
  // 확인을 누른 뒤, 그 사이 다른 종료가 그 판정을 다시 내려 버튼이 더는 서 있지 않을 때(레이스)
  'conversation.exited.bypassConfirm.failed': '다시 시도하지 못했습니다',
  // fix round 1 (Critical 2): durable 마크. notice 와 달리 첫 턴에 걷히지 않고, 세션이 사는 동안(그
  // 리고 죽은 뒤에도) 계속 보인다 — 언제나, 배너 우선순위와 무관하게 뜨는 별도 줄이다.
  'conversation.bypassed.badge': '이 세션은 이 프로젝트의 toolchain 버전 설정을 건너뛰고 시작되었습니다',
  'conversation.running.interrupt': '중단 (Esc)',
  'conversation.model.line': '{model} · {effort}',
  'conversation.model.effortRow': 'effort: {level}',
  'conversation.model.aria': '모델과 effort',
  'conversation.model.unknown': '모델',
  // ConversationPane.tsx — open() answering null, and a transcript that exists but has no turns yet.
  'conversation.indexingFiles': '파일 목록을 만드는 중…',
  'conversation.filesUnavailable': '이 폴더의 파일 목록을 가져올 수 없습니다.',
  'conversation.unavailable': '이 세션은 아직 기록이 없습니다',
  'conversation.empty': '아직 주고받은 것이 없습니다',
  'conversation.composer.placeholder': '무엇을 시킬까요',
  'conversation.loadingEarlier': '이전 대화 불러오는 중',
  // Task 10 — the terminal/conversation toggle in the session tab's own tab bar
  // Task 9 — the chat pane's request card (ChatRequestCard.tsx) and the plan-mode pill (ModelControl.tsx)
  'chat.ask.title': '{who} 가 묻습니다',
  'chat.approval.title': '{who} 가 {tool} 실행 허가를 묻습니다',
  'chat.approval.accept': '허용',
  'chat.approval.acceptForSession': '이 세션에서는 항상 허용',
  'chat.approval.decline': '거절',
  'chat.notice.checking': '상태를 확인하는 중',
  'chat.notice.endsWithApp': '이 세션은 앱을 끄면 끝납니다',
  'chat.notice.error': '턴이 실패했습니다: {message}',
  // 우회로 띄웠다는 것을 반드시 말한다 — 사용자가 이 폴더에 핀해 둔 것과 다른 버전이 떴을 수 있고,
  // 조용히 그러면 안 된다(설계 F5)
  'chat.notice.bypassed': '이 폴더의 toolchain 설정을 건너뛰고 띄웠습니다 — 핀해 둔 것과 다른 버전일 수 있습니다',
  'chat.mode.aria': '권한 모드',
  'chat.mode.default': '기본',
  'chat.mode.acceptEdits': '편집 자동 승인',
  'chat.mode.plan': '플랜',
  'chat.mode.auto': '자동',
  'remote.session.readOnly': '읽기 전용으로 페어링된 Runtime 이라 이 세션에 입력할 수 없습니다.',
  'remote.session.reconnecting': 'Runtime 에 다시 연결하는 중입니다. 세션은 그쪽에서 계속 돌고 있습니다.',
  'remote.session.gone': '이 세션의 출력을 받을 수 없습니다: {message}',
  'remote.session.ended': '세션이 끝났습니다 (종료 코드 {code})',
  'remote.session.sizedHost': '호스트 컴퓨터의 창 크기로 표시 중입니다. 입력하면 이 창 크기로 바뀝니다.',
  'remote.session.sizedOther': '다른 원격 컴퓨터의 창 크기로 표시 중입니다. 입력하면 이 창 크기로 바뀝니다.',
  'remote.session.sizedHostFixed': '호스트 컴퓨터의 창 크기로 표시 중입니다.',
  'remote.session.noPty': 'Runtime 이 이 세션의 터미널을 아직 알려 주지 않았습니다',
  'remote.session.readOnlyAnswer': '이 세션이 답을 기다리고 있지만, 읽기 전용으로 페어링되어 여기서는 답할 수 없습니다.',
  'remote.session.notReadable': '이 세션의 대화는 아직 Runtime 에서 읽을 수 없습니다.',
  'remote.session.status.working': '작업 중',
  'remote.session.status.waiting': '답을 기다림',
  'remote.session.status.idle': '대기',
  'remote.session.status.unknown': '상태 알 수 없음',
  'remote.session.earlier': '이전 대화',
  'remote.session.chatEnded': '이 세션은 Runtime 에서 끝났습니다.',
  'remote.session.composer': 'Runtime 의 세션에 보낼 메시지',
  'remote.session.inputLost': '방금 입력한 내용이 Runtime 에 전달되지 않았습니다. 연결이 돌아오면 다시 입력하세요.',
  'tabs.overflow.title': '이 워크스페이스의 모든 탭',
  'tabs.recent.title': '최근 닫은 탭',
  'tabs.recent.running': '실행 중',
  'tabs.recent.ended': '끝남',
  'summary.outcome.merged': '병합됨',
  'summary.outcome.mergedRounds': '병합됨 · 리뷰 {n}회',
  'summary.outcome.gaveUp': '포기함',
  'summary.outcome.stopped': '중지됨',
  'summary.outcome.done': '끝남',
  'summary.duration.s': '{s}초',
  'summary.duration.m': '{m}분',
  'summary.duration.hm': '{h}시간 {m}분',
  'summary.facts.files': '파일 {n}개 +{added} −{removed}',
  'summary.facts.checks': '검사 {passed}/{total}',
  'summary.facts.review': '리뷰 {n}회',
  'summary.facts.reviewVerdict': '리뷰 {n}회, {verdict}',
  'summary.facts.questions': '질문 {n}개 (리드 에이전트 {coordinator}, 당신 {owner})',
  'summary.facts.commits': '커밋 {n}개',
  'summary.verdict.approved': '승인',
  'summary.verdict.changes': '변경 요청',
  'summary.role.worker': '에이전트',
  'summary.role.session': '세션',
  'summary.card.ended': '{time}에 끝남',
  'summary.card.pr': '풀 리퀘스트',
  'summary.card.open': '열기',
  'summary.rollup.title': '지금까지 일어난 일',
  'tabs.strip.label': '열린 탭',
  'conversation.completion.label': '추천 항목',
  'agents.view.idle': '유휴',
  'agents.view.empty': '이 프로젝트에서 실행 중인 세션이 없습니다. + 버튼이나 새 플랜으로 시작하세요.',
  'agents.view.planEmpty': '{name}에는 아직 콘솔이 없습니다.',
  'agents.view.open': '콘솔 열기',
  'agents.view.filter': '계획별로 거르기',
  'agents.row.open': '열기',
  'agents.row.side': '옆에 열기',
  'agents.row.plan': '계획으로 이동',
  'agents.row.rename': '이름 바꾸기',
  'agents.row.stop': '중지',
  'agents.row.started': '시작: {when}',
  'agents.row.lastActive': '마지막 활동: {when}',
  'agents.header.label': '콘솔 정보',
  'agents.header.plan': '계획 {name} 열기',
  'agents.header.task': '계획에서 작업 {name} 보기',
  'agents.header.restart': '다시 시작',
} as const
