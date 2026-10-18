import { describe, expect, it } from 'vitest'
import { emailChangeOf } from './emailChange'

describe('emailChangeOf (#77)', () => {
  it('records the first email without calling it a switch', () => {
    expect(emailChangeOf({ label: 'a@x.com' }, 'a@x.com')).toEqual({ label: 'a@x.com', email: 'a@x.com', switched: false })
  })
  it('relabels a row still named after the old email and reports the switch', () => {
    expect(emailChangeOf({ label: 'a@x.com', email: 'a@x.com' }, 'b@x.com')).toEqual({ label: 'b@x.com', email: 'b@x.com', switched: true })
  })
  it('keeps a label the owner chose', () => {
    expect(emailChangeOf({ label: 'Work', email: 'a@x.com' }, 'b@x.com')).toEqual({ label: 'Work', email: 'b@x.com', switched: true })
  })
  it('changes nothing for the same email or an unreadable one', () => {
    expect(emailChangeOf({ label: 'a@x.com', email: 'a@x.com' }, 'a@x.com')).toBeNull()
    expect(emailChangeOf({ label: 'a@x.com', email: 'a@x.com' }, null)).toBeNull()
  })
})
