import { describe, it, expect } from 'vitest'
import { browserMenuActions, type BrowserMenuParams } from './browserMenu'

const base: BrowserMenuParams = {
  linkURL: '',
  selectionText: '',
  srcURL: '',
  mediaType: 'none',
  isEditable: false,
  editFlags: { canCut: false, canCopy: false, canPaste: false }
}
const kinds = (p: Partial<BrowserMenuParams>): string[] => browserMenuActions({ ...base, ...p }).map((a) => a.kind)

describe('browserMenuActions', () => {
  it('offers nothing on plain page space', () => {
    expect(kinds({})).toEqual([])
  })
  it('offers copy and open for a web link, copy only for other schemes', () => {
    expect(kinds({ linkURL: 'https://a.test/x' })).toEqual(['copyLink', 'openLink'])
    expect(kinds({ linkURL: 'mailto:a@b.c' })).toEqual(['copyLink'])
  })
  it('offers copy text for a selection outside fields', () => {
    expect(kinds({ selectionText: 'hi' })).toEqual(['copyText'])
    expect(kinds({ selectionText: '  ' })).toEqual([])
  })
  it('offers copy image address for http images but not data URLs', () => {
    expect(kinds({ mediaType: 'image', srcURL: 'https://a.test/i.png' })).toEqual(['copyImage'])
    expect(kinds({ mediaType: 'image', srcURL: 'data:image/png;base64,AAA' })).toEqual([])
  })
  it('offers only the edit actions the field allows', () => {
    expect(kinds({ isEditable: true, selectionText: 'x', editFlags: { canCut: true, canCopy: true, canPaste: true } })).toEqual(['cut', 'copy', 'paste'])
    expect(kinds({ isEditable: true, editFlags: { canCut: false, canCopy: false, canPaste: true } })).toEqual(['paste'])
  })
})
