// Korean · misc area. Which files each area serves: ../README.md.
export const misc = {
  'wall.plans.search': '플랜 찾기',
  'wall.scope.label': '범위',
  'wall.scope.plan': '이 플랜',
  'wall.scope.noProject': '프로젝트 없음',
  'wall.finished.title': '끝남 · 각 콘솔이 한 일',
  // 에이전트 세션을 어떻게 띄우고 이어가는가 — 일반에서 갈라져 나온 탭이다
  'worktrees.fact.ahead': '기준보다 앞',
  'worktrees.fact.behind': '기준보다 뒤',
  'session.usage.fiveHourLabel': '5시간 사용량',
  // W2-A planner stage
  'jobs.new.planner': '먼저 플래너로 계획하기',
  // W6-D
  'jobs.new.replan': '웨이브 사이에 다시 계획하기',
  'jobs.new.replanHint': '다음 웨이브 전마다, 그리고 끝에 한 번, 새 플래너가 아직 시작하지 않은 Task 를 실제 결과에 맞게 고칩니다. 그동안 새 워커는 기다립니다.',
  // W1-B: global scheduling
  'jobs.new.priority': '우선순위',
  'jobs.new.priorityHint': '앱 전체 워커 한도에 닿았을 때 높은 쪽이 먼저 빈자리를 받는다 (기본 0)',
  'jobs.new.schedule': '예약 실행',
  // 동시 실행 1 을 골랐는데 그 폴더에 이미 워커가 있을 때. 막지 않고 알려만 준다 —
  // 파일을 안 건드리는 워커끼리는 충돌할 것이 없고 앱은 그것을 알 수 없다
  // W6-A intake (components/intake/, pages/StartPage.tsx)
  'intake.open': '파일, 감사, GitHub 이슈로 새 계획…',
  'intake.title': '새 계획',
  'intake.project': '프로젝트',
  'intake.tab.describe': '설명',
  'intake.tab.files': '파일',
  'intake.tab.audit': '감사',
  'intake.tab.github': 'GitHub',
  // W8-C prompts mode
  'intake.tab.prompts': '적힌 그대로 실행',
  'intake.promptsHint': '.md 프롬프트 파일을 놓거나(파일마다 Task 하나) 문서 하나를 붙여 넣으세요(## 섹션마다 Task 하나). 글은 고쳐지지 않고, 순서는 docs/dev/PLAN.md 에서 옵니다.',
  'intake.promptsPaste': '또는 ## 섹션이 있는 문서 하나를 붙여 넣기',
  'intake.promptsAsk': '계획을 먼저 승인받기',
  'intake.describe': '무엇을 만들거나 고칠까요?',
  'intake.fixlist': '문제 목록이다: 문제마다 Task 하나 이상',
  'intake.drop': 'PDF 나 다른 파일을 여기에 놓으세요 (각 30 MB 이하)',
  'intake.note': '파일에 대한 메모 (선택)',
  'intake.scope': '감사할 것: 저장소 안의 경로, 또는 all',
  'intake.auditHint': '플래너가 버그, 보안 구멍, 빠진 테스트를 찾아 inputs/audit.md 에 쓰고 고칠 계획을 세웁니다.',
  'intake.search': '열린 이슈 찾기',
  'intake.assignMe': '고른 이슈를 나에게 할당',
  'intake.instructions': '추가 지시 (출처보다 우선)',
  'intake.create': '만들고 계획하기',
  // W7-D (#67)
  'intake.concurrency': '동시 워커 수 (1–100)',
  // 스케줄러가 워커를 띄울 계정을 못 골랐을 때 여는 Gate 의 문구(ipc.ts). 첫째는 예전부터
  // 있던 경우(그 provider 에 로그인된 계정이 없다), 둘째는 사람이 이 Task 에 지정한 계정을
  // 쓸 수 없는 경우다 — 지정을 무시하고 기본 계정으로 갈아타지 않으므로 사람에게 말해야 한다
  'conversation.model.effortMore': '더 보기 (터미널)',
  'conversation.model.effort': 'effort 바꾸기 (터미널에서)',
  'conversation.model.change': '모델과 effort 바꾸기 (터미널에서)',
  'remote.sessions.signedOut': '로그인 안 됨',
  'intake.after': '이 계획 다음에 시작',
  'intake.afterNone': '없음: 지금 계획',
  'pages.tasks.empty': '아직 Task 가 없습니다.',
  'pages.tasks.planning.badge': '계획 중',
  'pages.plans.folder': '폴더',
  'pages.plan.startAfterNow': '바로 시작',
  'new.console': '콘솔',
  'new.plan': '계획을 맡기기',
  'new.prompts': '적은 그대로 실행',
  'start.title': '{project}에서 무엇을 만들까요?',
  'start.titleNoProject': '프로젝트를 골라 계획을 시작하세요',
  // T2 Start: Audit mode, sticky hands-off, More options
  // T4 Start opens the planner chat
  'start.options': '옵션',
} as const
