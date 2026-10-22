// Korean · update area. Which files each area serves: ../README.md.
export const update = {
  'update.manual.title': '직접 설치',
  'update.manual.quit': '종료하고 옮기기',
  // App.tsx — the toast for a downloaded new version, and the session-kill confirmation when installing now
  'update.toast.available': '새 버전 v{version}이 나왔습니다',
  'update.toast.download': '다운로드',
  // Slice 2 of the Astera Host. Installing quits the app, so this is the same three-way split the
  // close confirmation faces, counted the same way (host.sessionsOutlivingApp) and shared with it —
  // see `updateConfirmBody`. `body` is unchanged and still exact when the app owns every session.
  //
  // The two new rows stop short of the close confirmation's promise on purpose: a Host on an older
  // protocol is retired by the app that finds it, and **only the incoming version knows whether its
  // protocol moved**. So they say what is knowable — these sessions outlive the quit — and leave the
  // rest to the update rather than promising a return this app cannot vouch for.
  //
  // es/ja have no row of their own for the two new keys and reach their English through the fallback
  // (see `t`), the same as common.quitConfirm.bodyMixed; they still want real translations.
  'update.confirm.title': '지금 설치하고 재시작',
  'update.confirm.body': '진행 중인 세션 {count}개가 종료됩니다. 계속할까요?',
  'update.confirm.bodyKept':
    '진행 중인 세션 {count}개는 Astera가 재시작하는 동안에도 계속 실행됩니다. 새 버전이 이어받을지는 업데이트에 따라 다르므로 돌아오지 않을 수도 있습니다. 계속할까요?',
  'update.confirm.bodyMixed':
    '진행 중인 세션 중 {ended}개는 종료됩니다. 나머지 {kept}개는 재시작하는 동안에도 계속 실행되지만, 새 버전이 이어받을지는 업데이트에 따라 다릅니다. 계속할까요?',
  // UpdateGate.tsx — the screen that covers the app when the version is below the minimum the release policy sets
  'update.gate.title': '업데이트가 필요합니다',
  'update.gate.body': '{version} 버전으로 업데이트를 진행해주세요',
  'update.gate.bodyNoVersion': '업데이트를 진행해주세요',
  'update.gate.preparing': '업데이트를 준비하고 있습니다…',
  'update.gate.ready': 'v{version} 설치 준비 완료',
  'update.gate.failed': '업데이트를 받지 못했습니다. 네트워크를 확인하고 다시 시도하세요.',
  'update.gate.retry': '다시 시도',
  'update.gate.quit': '앱 종료',
} as const
