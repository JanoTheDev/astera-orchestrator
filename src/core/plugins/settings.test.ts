import { describe, it, expect } from 'vitest'
import { coerceSetting, missingRequired, parseSettingsSchema, type SettingField } from './settings'

const fieldsOf = (raw: unknown): SettingField[] => {
  const r = parseSettingsSchema(raw)
  if (!r.ok) throw new Error(r.problems.join('; '))
  return r.fields
}
const problemsOf = (raw: unknown): string[] => {
  const r = parseSettingsSchema(raw)
  if (r.ok) throw new Error('expected problems')
  return r.problems
}

describe('parseSettingsSchema (spec §24)', () => {
  it('reads no schema as no settings', () => {
    expect(fieldsOf(undefined)).toEqual([])
  })

  it('reads each field with what it says, and which are required', () => {
    expect(
      fieldsOf({
        type: 'object',
        properties: {
          baseUrl: { type: 'string', title: 'Base URL', description: 'Where Jira answers', default: 'https://jira.example.com' },
          token: { type: 'string', secret: true },
          pageSize: { type: 'integer', default: 50, enum: [25, 50, 100] },
          ratio: { type: 'number' },
          dryRun: { type: 'boolean', default: false }
        },
        required: ['baseUrl', 'token']
      })
    ).toEqual([
      { key: 'baseUrl', type: 'string', title: 'Base URL', description: 'Where Jira answers', default: 'https://jira.example.com', required: true },
      { key: 'token', type: 'string', secret: true, required: true },
      { key: 'pageSize', type: 'integer', default: 50, enum: [25, 50, 100], required: false },
      { key: 'ratio', type: 'number', required: false },
      { key: 'dryRun', type: 'boolean', default: false, required: false }
    ])
  })

  it('refuses a schema that is not an object of properties', () => {
    expect(problemsOf([])).toEqual(['astera.settingsSchema is not an object'])
    expect(problemsOf({ type: 'array', properties: {} })).toEqual(["astera.settingsSchema.type must be 'object'"])
    expect(problemsOf({ type: 'object' })).toEqual(['astera.settingsSchema.properties is missing'])
    expect(problemsOf({ type: 'object', properties: {}, additionalProperties: false })).toEqual([
      'astera.settingsSchema.additionalProperties is not a settings keyword'
    ])
  })

  it('refuses a key that is not a plain name, and too many keys', () => {
    expect(problemsOf({ type: 'object', properties: { 'base-url': { type: 'string' } } })).toEqual([
      'astera.settingsSchema: base-url is not a settings key (a letter, then letters, digits or _, at most 64)'
    ])
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, { type: 'string' }]))
    expect(problemsOf({ type: 'object', properties: many })).toEqual(['astera.settingsSchema has 51 settings; at most 50'])
  })

  it('refuses a field of an unknown type, with an unknown keyword, or a secret that is not text', () => {
    expect(problemsOf({ type: 'object', properties: { a: { type: 'object' } } })).toEqual([
      "astera.settingsSchema.a.type must be 'string', 'number', 'integer' or 'boolean'"
    ])
    expect(problemsOf({ type: 'object', properties: { a: { type: 'string', format: 'uri' } } })).toEqual([
      'astera.settingsSchema.a.format is not a settings keyword'
    ])
    expect(problemsOf({ type: 'object', properties: { a: { type: 'number', secret: true } } })).toEqual([
      'astera.settingsSchema.a.secret is for a string setting only'
    ])
    expect(problemsOf({ type: 'object', properties: { a: { type: 'string', secret: 'yes' } } })).toEqual([
      'astera.settingsSchema.a.secret must be true'
    ])
  })

  it('refuses a default or an enum of the wrong type, an enum on a boolean, and a long title', () => {
    expect(problemsOf({ type: 'object', properties: { a: { type: 'integer', default: 1.5 } } })).toEqual([
      'astera.settingsSchema.a.default: 1.5 is not a whole number'
    ])
    expect(problemsOf({ type: 'object', properties: { a: { type: 'string', enum: ['x', 2] } } })).toEqual([
      'astera.settingsSchema.a.enum: 2 is not text'
    ])
    expect(problemsOf({ type: 'object', properties: { a: { type: 'boolean', enum: [true] } } })).toEqual([
      'astera.settingsSchema.a.enum is not for a boolean setting'
    ])
    expect(problemsOf({ type: 'object', properties: { a: { type: 'string', enum: ['x'], default: 'y' } } })).toEqual([
      'astera.settingsSchema.a.default: y is not one of x'
    ])
    expect(problemsOf({ type: 'object', properties: { a: { type: 'string', title: 'x'.repeat(65) } } })).toEqual([
      'astera.settingsSchema.a.title must be text of at most 64 characters'
    ])
  })

  it('refuses a required key that is no setting', () => {
    expect(problemsOf({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'b'] })).toEqual([
      'astera.settingsSchema.required names b, which is no setting'
    ])
    expect(problemsOf({ type: 'object', properties: {}, required: 'a' })).toEqual(['astera.settingsSchema.required is not a list'])
  })

  it('lists every problem at once', () => {
    expect(problemsOf({ type: 'object', properties: { 'x-y': { type: 'string' }, a: { type: 'list' } }, required: ['z'] })).toHaveLength(3)
  })
})

describe('coerceSetting', () => {
  const f = (over: Partial<SettingField>): SettingField => ({ key: 'k', type: 'string', required: false, ...over })
  it('takes a value of its type, and the text a command line gives', () => {
    expect(coerceSetting(f({ type: 'string' }), 'x')).toEqual({ ok: true, value: 'x' })
    expect(coerceSetting(f({ type: 'number' }), '1.5')).toEqual({ ok: true, value: 1.5 })
    expect(coerceSetting(f({ type: 'number' }), 2)).toEqual({ ok: true, value: 2 })
    expect(coerceSetting(f({ type: 'integer' }), '42')).toEqual({ ok: true, value: 42 })
    expect(coerceSetting(f({ type: 'boolean' }), 'true')).toEqual({ ok: true, value: true })
    expect(coerceSetting(f({ type: 'boolean' }), false)).toEqual({ ok: true, value: false })
  })
  it('refuses what is not of its type, naming the key', () => {
    expect(coerceSetting(f({ type: 'number' }), 'abc')).toEqual({ ok: false, problem: 'k: abc is not a number' })
    expect(coerceSetting(f({ type: 'number' }), '')).toEqual({ ok: false, problem: 'k:  is not a number' })
    expect(coerceSetting(f({ type: 'integer' }), '1.5')).toEqual({ ok: false, problem: 'k: 1.5 is not a whole number' })
    expect(coerceSetting(f({ type: 'boolean' }), 'yes')).toEqual({ ok: false, problem: 'k: yes is not true or false' })
    expect(coerceSetting(f({ type: 'string' }), 3)).toEqual({ ok: false, problem: 'k: 3 is not text' })
  })
  it('refuses a value outside its enum', () => {
    expect(coerceSetting(f({ type: 'integer', enum: [25, 50] }), '30')).toEqual({ ok: false, problem: 'k: 30 is not one of 25, 50' })
  })
})

describe('missingRequired', () => {
  it('names the required settings without a value or a default', () => {
    const fields = fieldsOf({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string', default: 'x' }, c: { type: 'string', secret: true }, d: { type: 'string' } },
      required: ['a', 'b', 'c']
    })
    expect(missingRequired(fields, () => false)).toEqual(['a', 'c'])
    expect(missingRequired(fields, (k) => k === 'a' || k === 'c')).toEqual([])
  })
})

// 2c final review M7, M9, M10.
describe('the settings review fixes', () => {
  const f = (over: Partial<SettingField>): SettingField => ({ key: 'k', type: 'string', required: false, ...over })

  it('never puts a secret value in a refusal', () => {
    expect(coerceSetting(f({ key: 'token', secret: true, enum: ['a-allowed'] }), 'my-real-secret')).toEqual({
      ok: false,
      problem: 'token: the value is not one of a-allowed'
    })
    expect(coerceSetting(f({ key: 'pin', secret: true }), 98765432)).toEqual({ ok: false, problem: 'pin: a secret setting takes text' })
  })

  it('reads a number from decimal digits only', () => {
    for (const bad of ['0x10', '0b11', '1e3', ' 42 ', '+5', '.5', '5.', 'Infinity'])
      expect(coerceSetting(f({ type: 'number' }), bad).ok, bad).toBe(false)
    expect(coerceSetting(f({ type: 'number' }), '-2.5')).toEqual({ ok: true, value: -2.5 })
    expect(coerceSetting(f({ type: 'integer' }), '-7')).toEqual({ ok: true, value: -7 })
    expect(coerceSetting(f({ type: 'integer' }), '07')).toEqual({ ok: true, value: 7 })
  })

  it('counts an empty text as not set for a required setting', () => {
    const fields = [f({ key: 'token', required: true, secret: true }), f({ key: 'url', required: true })]
    expect(missingRequired(fields, () => true, () => '')).toEqual(['token', 'url'])
    expect(missingRequired(fields, () => true, () => 'x')).toEqual([])
  })

  it('refuses two keys that differ only in case, which one file holds on Windows', () => {
    expect(problemsOf({ type: 'object', properties: { apiKey: { type: 'string' }, apikey: { type: 'string' } } })).toEqual([
      'astera.settingsSchema: apikey and apiKey differ only in case'
    ])
  })
})
