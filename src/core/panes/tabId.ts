// 탭 식별자. 페인이 담는 탭은 세션·파일·기록·미리보기고, 트리는 그 구분을 몰라야 하므로(tree.ts 머리주석의
// core 규약) 트리에는 불투명한 문자열만 들어간다. 그 문자열을 만들고 해석하는 책임이 이 모듈에 있다.
// 파일 탭 id는 이 모듈이 생기기 전부터 `file:${path}` 형식이었다(FileTabs.tsx의 FileTab.id) — 새 형식을
// 도입하는 것이 아니라 흩어져 있던 형식을 한 곳으로 모으는 것이다.
// node: import 없음 — 렌더러가 import한다.
export type TabKind = 'session' | 'file' | 'record' | 'browser' | 'app' | 'media' | 'view'
export type TabRef = { kind: TabKind; id: string }

export const sessionTab = (sessionId: string): string => `session:${sessionId}`
/** A session on a paired Runtime (remote runtime design D1.4): the renderer knows it by `<runtimeId>:<sessionId>`, so
 *  its tab is `sessionTab(key)` = `session:<runtimeId>:<sessionId>`. A local session's id has no colon, so the two never
 *  meet, and a local tab id does not change. */
export const remoteSessionKey = (runtimeId: string, sessionId: string): string => `${runtimeId}:${sessionId}`
export function parseRemoteSessionKey(key: string): { runtimeId: string; sessionId: string } | null {
  const i = key.indexOf(':')
  if (i <= 0 || i === key.length - 1) return null
  return { runtimeId: key.slice(0, i), sessionId: key.slice(i + 1) }
}
export const isRemoteSessionKey = (key: string): boolean => parseRemoteSessionKey(key) !== null
export const fileTab = (path: string): string => `file:${path}`
/** How It Works's record detail. Stands in the same row as a session or a file, and the tree does
 *  not tell the three apart. */
export const recordTab = (recordId: string): string => `record:${recordId}`
/** A preview (embedded browser) tab. The id is random (crypto.randomUUID() at the call site), never
 *  the URL: the address changes as the page navigates, and the tree node must not. */
export const browserTab = (id: string): string => `browser:${id}`
/** An agent app workspace's mirror tab (agent workspace plan ruling P7). One per session, so the id is
 *  the session's: a second open finds the first. */
export const appTab = (sessionId: string): string => `app:${sessionId}`
/** The media viewer (components/MediaViewer.tsx). The id is the file's absolute path, like a file
 *  tab's, so the tab needs no record of its own: everything it draws is that path. A second open of
 *  the same file finds this one (place.ts placeMediaTab). */
export const mediaTab = (path: string): string => `media:${path}`

/** The pages that open as editor tabs in the workbench (`view:<name>` or `view:<name>:<arg>`). */
export type ViewName = 'welcome' | 'plan' | 'mainplan' | 'start' | 'settings' | 'worktree' | 'device'
const VIEW_NAMES: readonly string[] = ['welcome', 'plan', 'mainplan', 'start', 'settings', 'worktree', 'device']
/** The arg may hold colons (a Windows path): only the first colon after the name splits. */
export const viewTab = (name: ViewName, arg?: string): string => (arg === undefined ? `view:${name}` : `view:${name}:${arg}`)
/** An unknown name or a non-view id is null — never throws. */
export function parseViewTab(tabId: string): { name: ViewName; arg?: string } | null {
  const ref = parseTab(tabId)
  if (ref?.kind !== 'view') return null
  const i = ref.id.indexOf(':')
  const name = i < 0 ? ref.id : ref.id.slice(0, i)
  const arg = i < 0 ? undefined : ref.id.slice(i + 1)
  if (!VIEW_NAMES.includes(name) || arg === '') return null
  return arg === undefined ? { name: name as ViewName } : { name: name as ViewName, arg }
}

/** 탭 id가 아닌 문자열은 null — 던지지 않는다. 저장된 옛 상태나 다른 종류의 id를 만나도 화면이 죽지
 *  않아야 한다. Windows 경로의 드라이브 콜론 때문에 쪼개기는 첫 콜론에서만 한다. */
export function parseTab(tabId: string): TabRef | null {
  const i = tabId.indexOf(':')
  if (i <= 0) return null // 콜론이 없거나 맨 앞에 있으면 종류가 없다
  const kind = tabId.slice(0, i)
  const id = tabId.slice(i + 1)
  if (id === '') return null
  return kind === 'session' || kind === 'file' || kind === 'record' || kind === 'browser' || kind === 'app' || kind === 'media' || kind === 'view'
    ? { kind, id }
    : null
}
