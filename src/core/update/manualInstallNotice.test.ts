import { describe, it, expect } from 'vitest'
import { installOutcomeNotice, readyToast } from './manualInstallNotice'

describe('installOutcomeNotice — 설치 버튼을 누른 뒤 사람에게 할 말', () => {
  it('자동 경로에는 할 말이 없다 — 앱이 곧 스스로 꺼진다', () => {
    expect(installOutcomeNotice({ mode: 'auto' })).toBeNull()
  })

  it('수동 경로면 어디에 풀어 놨는지 말한다', () => {
    expect(installOutcomeNotice({ mode: 'manual', appPath: '/c/manual/1.3.25/Astera.app' })).toEqual({
      key: 'update.manual.done',
      params: { path: '/c/manual/1.3.25/Astera.app' }
    })
  })

  it('실패하면 이유를 말한다 — 침묵이 이 버그의 절반이었다', () => {
    expect(installOutcomeNotice({ mode: 'failed', message: 'ditto: 공간 부족' })).toEqual({
      key: 'update.manual.failed',
      params: { message: 'ditto: 공간 부족' }
    })
  })
})

describe('readyToast — 설치할 빌드가 왔을 때 띄우는 토스트', () => {
  it('내려받았으면 재시작해 설치하라고 한다', () => {
    expect(readyToast({ state: 'downloaded', version: '1.4.2' })).toEqual({
      message: { key: 'update.toast.ready', params: { version: '1.4.2' } },
      action: 'update.toast.installNow'
    })
  })

  it('Squirrel 이 거부했으면 직접 설치라고 바꿔 말한다 — "지금 설치" 는 이 빌드에 거짓말이다', () => {
    expect(readyToast({ state: 'manual', version: '1.4.2', message: 'Code signature … did not pass validation' })).toEqual({
      message: { key: 'update.toast.manual', params: { version: '1.4.2' } },
      action: 'update.toast.manualInstall'
    })
  })

  it('그 밖의 상태에는 띄우지 않는다', () => {
    for (const state of ['init', 'checking', 'available', 'downloading', 'uptodate', 'error'] as const)
      expect(readyToast({ state })).toBeNull()
  })
})
