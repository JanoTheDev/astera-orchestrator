// Moved out of App.tsx unchanged (W9-A): the JSX is App's, the values come from App's state hooks.
import { House, PanelLeft, Settings } from 'lucide-react'
import type { AppState } from '../../state/appState'

export type RailProps = Pick<
  AppState,
  'bottomRoot' | 'explorerOpen' | 'explorerShortcutLabel' | 'hiwOpen' | 'homeShortcutLabel' | 'jobsOpen' |
  'openTerminal' | 'setShowSettings' | 'setSidebarOpen' | 'sidebarOpen' | 'sidebarPane' | 't' | 'toggleExplorer' |
  'toggleHiw' | 'toggleJobs' | 'toggleSessions'
>

export function Rail(p: RailProps): React.JSX.Element {
  const {
    bottomRoot, explorerOpen, explorerShortcutLabel, hiwOpen, homeShortcutLabel, jobsOpen, openTerminal,
    setShowSettings, setSidebarOpen, sidebarOpen, sidebarPane, t, toggleExplorer, toggleHiw, toggleJobs,
    toggleSessions
  } = p
  return (
    <>
        <nav className="rail">
          <button
            className={sidebarOpen ? 'rail-btn on' : 'rail-btn'}
            aria-label={t('session.rail.toggleSidebar')}
            title={t('session.rail.toggleSidebar')}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <PanelLeft size={16} />
          </button>
          {/* 계정·히스토리 토글. 다른 셋과 달리 "아무 뷰도 안 켠 상태" 라 버튼이 없었고, 그래서 탐색기나
              Jobs 를 한 번 열면 한 번의 누름으로는 돌아올 수 없었다 — 그 뷰를 끄면 사이드바가 함께
              접히므로(core/ui/sidebar.ts), 펴기 버튼을 한 번 더 눌러야 비로소 이 화면이었다.
              자리는 탐색기 위다: 이것이 사이드바의 기본 화면이고, 레일은 위에서부터 기본을 먼저 둔다 */}
          <button
            className={sidebarOpen && sidebarPane === 'sessions' ? 'rail-btn on' : 'rail-btn'}
            aria-label={homeShortcutLabel}
            title={homeShortcutLabel}
            onClick={toggleSessions}
          >
            <House size={16} />
          </button>
          {/* 탐색기 토글. 폴더 아이콘과 컨텍스트 메뉴 항목을 걷어내면서 탐색기로 들어가는 길이 단축키
              하나만 남았는데, 처음 쓰는 사람은 그 키를 알 수 없다. 툴팁에 실제 바인딩을 함께 띄우므로
              한 번 눌러 본 사람은 다음부터 키를 쓴다 — 발견과 학습이 같은 자리에서 끝난다.
              사이드바가 접혀 있으면 함께 편다. 안 그러면 눌러도 아무것도 나타나지 않는다 */}
          <button
            className={explorerOpen ? 'rail-btn on' : 'rail-btn'}
            aria-label={explorerShortcutLabel}
            title={explorerShortcutLabel}
            onClick={toggleExplorer}
          >
            {/* 파일 트리 — 폴더 하나와 그 안의 줄 둘. 앱의 SVG 관례대로 16 viewBox 에 currentColor 하나 */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            >
              <path d="M1.8 4.1a1 1 0 0 1 1-1h3.1l1.4 1.6h5.9a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />
              <g strokeWidth="1.2" strokeLinecap="round">
                <line x1="5" y1="8.2" x2="11" y2="8.2" />
                <line x1="5" y1="10.6" x2="9" y2="10.6" />
              </g>
            </svg>
          </button>
          {/* Jobs 사이드바 토글. 오케스트레이션은 Astera 가 늘 갖고 있는 것이므로 조건 없이 그린다. */}
          <button
            className={jobsOpen ? 'rail-btn on' : 'rail-btn'}
            aria-label={t('jobs.rail.open')}
            title={t('jobs.rail.open')}
            onClick={toggleJobs}
          >
            {/* Jobs — 체크리스트. 앱의 SVG 관례대로 16 viewBox 에 currentColor 하나, 바깥 사각형은
                1.4, 안쪽 체크와 줄은 1.2 */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            >
              <rect x="2.6" y="1.8" width="10.8" height="12.4" rx="1.4" />
              <g strokeWidth="1.2" strokeLinecap="round">
                <path d="M4.8 5.2 5.7 6.1 7.3 4.3" />
                <line x1="9" y1="5.4" x2="11.4" y2="5.4" />
                <path d="M4.8 9.6 5.7 10.5 7.3 8.7" />
                <line x1="9" y1="9.8" x2="11.4" y2="9.8" />
              </g>
            </svg>
          </button>
          {/* How It Works 사이드바 토글. */}
          <button
            className={hiwOpen ? 'rail-btn on' : 'rail-btn'}
            aria-label={t('hiw.rail.open')}
            title={t('hiw.rail.open')}
            onClick={toggleHiw}
          >
            {/* 지도 — 흐름을 읽는다는 뜻. 앱의 SVG 관례대로 16 viewBox 에 currentColor 하나, 바깥
                사각형은 1.4, 안쪽 갈래는 1.2 */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            >
              <rect x="2" y="2.4" width="12" height="11.2" rx="1.4" />
              <g strokeWidth="1.2" strokeLinecap="round">
                <path d="M8 4.6 v2.2" />
                <path d="M5.2 11.4 v-1.6 h5.6 v1.6" />
                <path d="M8 6.8 v3" />
              </g>
            </svg>
          </button>
          {/* 아래쪽 패널을 여는 입구. 페인을 가리지 않는다 — 프로젝트가 없으면 홈에서 열리므로 어느
              화면에서든 셸을 하나 띄울 수 있다. 예전에는 explorerOpen 이었고 주석도 "파일·에디터 모드
              전용"이라고 적혀 있었는데, 이 패널이 탐색기의 것이 아니게 된 뒤로는 둘 다 거짓이 됐다.
              터미널과 ⚙ 은 .rail-bottom 으로 감싸고 그 wrapper 가 margin-top:auto 를 지므로 둘이 함께
              아래에 붙는다 — 터미널 버튼에 따로 auto 마진을 주면(auto 형제가 둘) 남은 공간이 균등
              분배되어 버튼들이 벌어진다. */}
          <span className="rail-bottom">
            {bottomRoot && (
              <button
                className="rail-btn"
                aria-label={t('terminal.rail.open')}
                title={t('terminal.rail.open')}
                onClick={() => void openTerminal()}
              >
                {/* The same window-plus-prompt shape as IntelliJ's terminal icon. Per the app's SVG
                    convention it is a 16 viewBox in a single currentColor, with only the inner >_
                    dropped to stroke 1.2 — two elements sit inside a 12.8×10.8 window, and at the same
                    1.4 as the outline the ink merges on a 30px button. */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                >
                  <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6" />
                  <g strokeWidth="1.2" strokeLinecap="round">
                    <path d="M4.5 7.2 6.1 8.8 4.5 10.4" />
                    <line x1="7.8" y1="10.5" x2="11.4" y2="10.5" />
                  </g>
                </svg>
              </button>
            )}
            <button
              className="rail-btn rail-settings"
              aria-label={t('settings.title')}
              title={t('settings.title')}
              onClick={() => setShowSettings(true)}
            >
              <Settings size={16} />
            </button>
          </span>
        </nav>
    </>
  )
}
