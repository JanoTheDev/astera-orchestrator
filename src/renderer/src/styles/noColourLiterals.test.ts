/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Colour lives in styles/tokens.css only. A literal anywhere else is a place no theme can repaint: it looks right
// on night and wrong on day. (Generalised from styles.hiw.test.ts, whose How It Works checks are kept below.)
const ROOT = path.join(__dirname, '..')
const ALLOWED = new Set([path.join(ROOT, 'styles', 'tokens.css')])

const cssFiles = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) cssFiles(p, out)
    else if (e.name.endsWith('.css') && !ALLOWED.has(p)) out.push(p)
  }
  return out
}

// **주석을 먼저 지운다.** 주석에 색 예시를 적는 순간 검사 대상이 아닌 것으로 테스트가 실패한다 — 그런 테스트는
// 곧 무시된다. url() 도 지운다: data URI 의 svg 안에 stroke='black' 같은 것이 들어 있다.
const stripped = (f: string): string =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, 'url()')

describe('no colour literals outside styles/tokens.css', () => {
  const files = cssFiles(ROOT)

  it('finds the stylesheets — an empty walk would make the next check pass on nothing', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('no #hex, rgb(), rgba(), hsl() or named black/white', () => {
    const hits: string[] = []
    for (const f of files) {
      stripped(f).split('\n').forEach((line, i) => {
        const m = /#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl)a?\(|(?<![-\w])(white|black)(?![-\w])/.exec(line)
        if (m) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${m[0]}`)
      })
    }
    expect(hits).toEqual([])
  })
})

/** 선택자에 `.hiw-` 가 들어간 규칙만 뽑는다.
 *
 *  **앞선 규칙의 닫는 중괄호를 앵커로 쓰지 않는다.** `(^|\})` 로 시작하면 그 중괄호가 매치에
 *  먹히고, 다음 매치는 그 다음 규칙의 닫는 중괄호를 찾아 그 뒤의 선택자를 잡는다 — 결과적으로 한
 *  규칙씩 건너뛰며 절반만 검사한다. 선택자 그룹이 이미 `[^{}]*` 라 중괄호를 넘지 못하므로 앵커
 *  없이도 "직전 중괄호 이후 전부"가 정확히 선택자가 된다. */
const hiwRules = (): string[] =>
  [...stripped(path.join(ROOT, 'components', 'hiw.css')).matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((m) => m[1].includes('.hiw-'))
    .map((m) => `${m[1].trim()}{${m[2]}}`)

describe('How It Works 의 테마 규약', () => {
  it('규칙을 실제로 찾아낸다', () => {
    expect(hiwRules().length).toBeGreaterThan(10)
  })

  it('선택 표시는 배경과 함께 준다 — --marker-w 가 0 인 테마에서도 보여야 한다', () => {
    for (const rule of hiwRules()) {
      if (!rule.includes('--marker-w')) continue
      expect(rule, rule).toMatch(/background:/)
    }
  })

  it('줄 제목은 두 줄에서 자른다 — /goal 인자는 문단일 수 있다', () => {
    const rule = hiwRules().find((r) => r.startsWith('.hiw-name{'))
    expect(rule).toBeDefined()
    // 넷 다 있어야 자름이 실제로 걸린다 — 어느 하나만 빠져도 나머지 셋은 그대로 있어 이 단언들이
    // 조용히 통과하면서 자름은 소리 없이 풀린다(final review, item 6)
    expect(rule).toMatch(/display:\s*-webkit-box/)
    expect(rule).toMatch(/-webkit-box-orient:\s*vertical/)
    expect(rule).toMatch(/-webkit-line-clamp:\s*2/)
    expect(rule).toMatch(/overflow:\s*hidden/)
  })
})
