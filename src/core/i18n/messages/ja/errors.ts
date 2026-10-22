// Japanese · errors area. Which files each area serves: ../README.md.
import type { errors as ko } from '../ko/errors'

export const errors: Partial<Record<keyof typeof ko, string>> = {
  'app.renderError': 'この画面の描画中に問題が発生しました。',
  'app.renderErrorReload': '再読み込み',
}
