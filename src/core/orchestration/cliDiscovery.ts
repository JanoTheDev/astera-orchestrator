// 세션 밖에서 실행된 `astera` 가 프로필 폴더를 찾는 법 (공개 CLI 설계 §4). 규칙은 SDK 패키지의 것이다
// (packages/client/src/discovery.ts) — CLI 와 @astera-app/client 가 같은 Host 를 찾는다.
export { nativePath, userDataDir } from '../publicContract'
