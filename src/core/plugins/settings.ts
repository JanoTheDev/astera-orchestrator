// A plugin's settings (SDK + Plugin spec §24; plugin runtime design, slice 2c): the `astera.settingsSchema` of its
// manifest, a small subset of JSON Schema that a generic form and `astera plugins configure` can both serve. Pure, so
// the Host, the CLI and the app read the same rules. A secret field (§23) is text kept apart and never shown back.

export type SettingValue = string | number | boolean

export interface SettingField {
  key: string
  type: 'string' | 'number' | 'integer' | 'boolean'
  title?: string
  description?: string
  default?: SettingValue
  enum?: SettingValue[]
  /** Kept in the plugin's secret store, never answered to anyone but the plugin, redacted from its log. */
  secret?: true
  required: boolean
}

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const MAX_FIELDS = 50
const MAX_ENUM = 50
const TITLE_MAX = 64
const DESCRIPTION_MAX = 500
const TYPES = ['string', 'number', 'integer', 'boolean'] as const
const FIELD_KEYWORDS = new Set(['type', 'title', 'description', 'default', 'enum', 'secret'])
const TOP_KEYWORDS = new Set(['type', 'properties', 'required'])
const PREFIX = 'astera.settingsSchema'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Why `value` is not one of `type`, or null. */
function typeProblem(type: SettingField['type'], value: unknown): string | null {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? null : `${String(value)} is not text`
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${String(value)} is not a number`
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? null : `${String(value)} is not a whole number`
    case 'boolean':
      return typeof value === 'boolean' ? null : `${String(value)} is not true or false`
  }
}

export function parseSettingsSchema(raw: unknown): { ok: true; fields: SettingField[] } | { ok: false; problems: string[] } {
  if (raw === undefined) return { ok: true, fields: [] }
  if (!isObject(raw)) return { ok: false, problems: [`${PREFIX} is not an object`] }
  const problems: string[] = []
  for (const k of Object.keys(raw)) if (!TOP_KEYWORDS.has(k)) problems.push(`${PREFIX}.${k} is not a settings keyword`)
  if (raw.type !== 'object') problems.push(`${PREFIX}.type must be 'object'`)
  if (raw.properties === undefined) {
    problems.push(`${PREFIX}.properties is missing`)
    return { ok: false, problems }
  }
  if (!isObject(raw.properties)) {
    problems.push(`${PREFIX}.properties is not an object`)
    return { ok: false, problems }
  }
  const keys = Object.keys(raw.properties)
  if (keys.length > MAX_FIELDS) problems.push(`${PREFIX} has ${keys.length} settings; at most ${MAX_FIELDS}`)
  let required: string[] = []
  if (raw.required !== undefined) {
    if (!Array.isArray(raw.required) || !raw.required.every((r) => typeof r === 'string')) problems.push(`${PREFIX}.required is not a list`)
    else {
      required = raw.required as string[]
      for (const r of required) if (!keys.includes(r)) problems.push(`${PREFIX}.required names ${r}, which is no setting`)
    }
  }
  const fields: SettingField[] = []
  for (const key of keys) {
    const at = `${PREFIX}.${key}`
    if (!KEY.test(key)) {
      problems.push(`${PREFIX}: ${key} is not a settings key (a letter, then letters, digits or _, at most 64)`)
      continue
    }
    const f = raw.properties[key]
    if (!isObject(f)) {
      problems.push(`${at} is not an object`)
      continue
    }
    const before = problems.length
    for (const k of Object.keys(f)) if (!FIELD_KEYWORDS.has(k)) problems.push(`${at}.${k} is not a settings keyword`)
    if (!(TYPES as readonly unknown[]).includes(f.type)) {
      problems.push(`${at}.type must be 'string', 'number', 'integer' or 'boolean'`)
      continue
    }
    const type = f.type as SettingField['type']
    if (f.title !== undefined && (typeof f.title !== 'string' || f.title.length > TITLE_MAX))
      problems.push(`${at}.title must be text of at most ${TITLE_MAX} characters`)
    if (f.description !== undefined && (typeof f.description !== 'string' || f.description.length > DESCRIPTION_MAX))
      problems.push(`${at}.description must be text of at most ${DESCRIPTION_MAX} characters`)
    if (f.secret !== undefined) {
      if (f.secret !== true) problems.push(`${at}.secret must be true`)
      else if (type !== 'string') problems.push(`${at}.secret is for a string setting only`)
    }
    let choices: SettingValue[] | undefined
    if (f.enum !== undefined) {
      if (type === 'boolean') problems.push(`${at}.enum is not for a boolean setting`)
      else if (!Array.isArray(f.enum) || f.enum.length === 0 || f.enum.length > MAX_ENUM)
        problems.push(`${at}.enum must be a list of 1 to ${MAX_ENUM} values`)
      else {
        const bad = f.enum.map((v) => typeProblem(type, v)).find((p) => p !== null)
        if (bad) problems.push(`${at}.enum: ${bad}`)
        else choices = f.enum as SettingValue[]
      }
    }
    if (f.default !== undefined) {
      const bad = typeProblem(type, f.default)
      if (bad) problems.push(`${at}.default: ${bad}`)
      else if (choices && !choices.includes(f.default as SettingValue))
        problems.push(`${at}.default: ${String(f.default)} is not one of ${choices.join(', ')}`)
    }
    if (problems.length > before) continue
    fields.push({
      key,
      type,
      ...(typeof f.title === 'string' ? { title: f.title } : {}),
      ...(typeof f.description === 'string' ? { description: f.description } : {}),
      ...(f.default !== undefined ? { default: f.default as SettingValue } : {}),
      ...(choices ? { enum: choices } : {}),
      ...(f.secret === true ? { secret: true as const } : {}),
      required: required.includes(key)
    })
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, fields }
}

/** A value for `field`, from one of its type or from the text a command line gives (`astera plugins configure`). */
export function coerceSetting(field: SettingField, value: unknown): { ok: true; value: SettingValue } | { ok: false; problem: string } {
  let v: unknown = value
  if (typeof value === 'string' && field.type !== 'string') {
    if (field.type === 'boolean') v = value === 'true' ? true : value === 'false' ? false : value
    else if (value.trim() !== '' && Number.isFinite(Number(value))) v = Number(value)
  }
  const bad = typeProblem(field.type, v)
  if (bad) return { ok: false, problem: `${field.key}: ${bad}` }
  if (field.enum && !field.enum.includes(v as SettingValue)) return { ok: false, problem: `${field.key}: ${String(v)} is not one of ${field.enum.join(', ')}` }
  return { ok: true, value: v as SettingValue }
}

/** The required settings with neither a value (`has`) nor a default. */
export const missingRequired = (fields: readonly SettingField[], has: (key: string) => boolean): string[] =>
  fields.filter((f) => f.required && f.default === undefined && !has(f.key)).map((f) => f.key)
