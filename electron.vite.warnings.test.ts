// The build's warning filter (electron.vite.warnings.ts): it drops zod's false INVALID_ANNOTATION and nothing else.
import { describe, it, expect } from 'vitest'
import { isNoise } from './electron.vite.warnings'

const zod = (file: string) => ({
  code: 'INVALID_ANNOTATION',
  id: `D:\\parsingk\\astera\\node_modules\\zod\\v4\\core\\${file}`,
  message: 'A comment … contains an annotation that Rollup cannot interpret due to the position of the comment.'
})

describe('the build warning filter', () => {
  it("drops the INVALID_ANNOTATION that zod's prose comments about @__PURE__ raise, with either separator", () => {
    expect(isNoise(zod('util.js'))).toBe(true)
    expect(isNoise({ ...zod('regexes.js'), id: '/home/runner/work/astera/node_modules/zod/v4/core/regexes.js' })).toBe(true)
  })

  it('keeps the same warning from any other file, and every other warning from zod', () => {
    expect(isNoise({ ...zod('util.js'), id: 'D:\\parsingk\\astera\\src\\core\\run\\python.ts' })).toBe(false)
    expect(isNoise({ ...zod('util.js'), id: 'D:\\parsingk\\astera\\node_modules\\zod-to-json-schema\\dist\\index.js' })).toBe(false)
    expect(isNoise({ ...zod('util.js'), code: 'CIRCULAR_DEPENDENCY' })).toBe(false)
    expect(isNoise({ code: 'INVALID_ANNOTATION', message: 'no file' })).toBe(false)
  })
})
