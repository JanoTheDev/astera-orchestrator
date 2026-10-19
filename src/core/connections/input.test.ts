import { describe, it, expect } from 'vitest'
import { t } from '../i18n'
import { toSessionInput, buildChoiceKeys, type ChoiceShape } from './input'

describe('toSessionInput', () => {
  it('한 줄은 텍스트만 돌려주고 제출 플래그를 켠다 — Enter는 SlackInbox가 지연 후 별도로 보낸다', () => {
    expect(toSessionInput('계속')).toEqual({ text: '계속', submit: true })
  })

  it('여러 줄은 Alt+Enter(ESC+CR)로 개행한다 — text에 마지막 Enter는 포함하지 않는다', () => {
    // 개행을 그대로 보내면 줄마다 제출로 받아 여러 턴이 시작된다
    expect(toSessionInput('첫 줄\n두 번째 줄')).toEqual({ text: '첫 줄\x1b\r두 번째 줄', submit: true })
  })

  it('CRLF·CR 단독도 같은 방식으로 접는다', () => {
    expect(toSessionInput('a\r\nb')).toEqual({ text: 'a\x1b\rb', submit: true })
    expect(toSessionInput('a\rb')).toEqual({ text: 'a\x1b\rb', submit: true })
  })

  it('개행 세 개 이상도 각각 변환된다', () => {
    expect(toSessionInput('a\nb\nc')).toEqual({ text: 'a\x1b\rb\x1b\rc', submit: true })
  })

  it('C0 제어문자·DEL은 제거한다 — 개행(\\n·\\r)만 예외다', () => {
    expect(toSessionInput('a\x03\x04b')).toEqual({ text: 'ab', submit: true }) // Ctrl+C(턴 중단)·Ctrl+D(종료)
    expect(toSessionInput('\x1b[31mred\x1b[0m')).toEqual({ text: '[31mred[0m', submit: true }) // ESC 제거로 ANSI 무력화
    expect(toSessionInput('탭\t구분')).toEqual({ text: '탭구분', submit: true }) // 탭(0x09)도 C0이라 제거된다
    expect(toSessionInput('줄1\n줄2')).toEqual({ text: '줄1\x1b\r줄2', submit: true }) // 의도한 개행은 남는다
  })
})

describe('buildChoiceKeys', () => {
  const multi = (n: number): ChoiceShape => ({ multiSelect: true, optionCount: n })
  const single = (n: number): ChoiceShape => ({ multiSelect: false, optionCount: n })
  // 실패 사유는 Message라 여기서 ko로 번역해 문구까지 함께 검증한다 — 템플릿의 자리표시자가
  // 빠지면 아래 단정이 잡는다.
  const keys = (text: string, shape: ChoiceShape[]): string[] | string => {
    const r = buildChoiceKeys(text, shape)
    return r.ok ? r.keys : t('ko', r.reason.key, r.reason.params)
  }

  it('다중 선택은 번호를 토글한 뒤 Tab으로 Submit 탭까지 옮기고 Enter로 제출한다', () => {
    // 숫자는 포커스를 옮기지 않고 토글만 한다 — 그래서 Tab이 따로 필요하다 (buildChoiceKeys 주석)
    expect(keys('1,3', [multi(3)])).toEqual(['1', '3', '\t', '\r'])
    expect(keys('2', [multi(3)])).toEqual(['2', '\t', '\r'])
    expect(keys(' 1 , 2 ', [multi(3)])).toEqual(['1', '2', '\t', '\r']) // 공백은 무시
  })

  it('단일 선택에는 Tab을 넣지 않는다 — 답하면 shouldAdvance로 저절로 전진한다', () => {
    expect(keys('2', [single(4)])).toEqual(['2', '\r'])
  })

  it('여러 질문은 슬래시로 나누고, 질문마다 모드에 맞는 전진을 붙인다', () => {
    expect(keys('1,3 / 2', [multi(3), single(2)])).toEqual(['1', '3', '\t', '2', '\r'])
    expect(keys('1 / 2 / 1', [single(2), single(2), single(2)])).toEqual(['1', '2', '1', '\r'])
    expect(keys('1 / 2', [multi(2), multi(2)])).toEqual(['1', '\t', '2', '\t', '\r'])
  })

  it('형식이 어긋나면 아무 키도 만들지 않고 이유를 돌려준다 — 잘못 누른 시퀀스는 되돌릴 수 없다', () => {
    expect(keys('1', [multi(3), single(2)])).toContain('/') // 답이 질문 수보다 적다 → 형식 안내
    expect(keys('1 / 2 / 3', [multi(3)])).toContain('/')
    expect(keys('4', [multi(3)])).toContain('없습니다') // 범위 밖
    expect(keys('0', [multi(3)])).toContain('없습니다')
    expect(keys('12', [multi(3)])).toContain('없습니다') // 두 글자는 키 하나로 못 보낸다
    expect(keys('1,2', [single(3)])).toContain('하나만') // 단일 선택에 여러 번호
    expect(keys('없음', [multi(3)])).toContain('번호')
    expect(keys('1', [])).toContain('찾지 못했습니다') // 모양 정보 없음
  })
})
