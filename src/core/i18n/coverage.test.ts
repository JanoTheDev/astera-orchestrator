import { describe, it, expect } from 'vitest'
import { CATALOGS } from './index'
import { en } from './messages/en'
import { UNTRANSLATED } from './coverageAllowlist'

// A key en has and another locale lacks shows English there. That is allowed only for the keys listed in
// coverageAllowlist.ts, so a new gap fails here instead of shipping silently.
describe('every locale has every en key', () => {
  const allowed = new Set<string>(UNTRANSLATED)
  for (const lang of ['ko', 'ja', 'es'] as const) {
    it(lang, () => {
      const messages = CATALOGS[lang].messages
      const missing = Object.keys(en).filter((k) => !(k in messages) && (lang === 'ko' || !allowed.has(k)))
      expect(missing).toEqual([])
    })
  }
})
