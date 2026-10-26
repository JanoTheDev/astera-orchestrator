/** What the browser pane's right-click menu offers for the thing under the pointer, from the
 *  webview `context-menu` params. Pure so the rules are testable without a webview. */
export type BrowserMenuParams = {
  linkURL: string
  selectionText: string
  srcURL: string
  mediaType: string
  isEditable: boolean
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean }
}

export type BrowserMenuAction =
  | { kind: 'copyLink'; url: string }
  | { kind: 'openLink'; url: string }
  | { kind: 'copyText'; text: string }
  | { kind: 'copyImage'; url: string }
  | { kind: 'cut' }
  | { kind: 'copy' }
  | { kind: 'paste' }

const WEB_URL = /^https?:\/\//i

export function browserMenuActions(p: BrowserMenuParams): BrowserMenuAction[] {
  const out: BrowserMenuAction[] = []
  if (p.linkURL) {
    out.push({ kind: 'copyLink', url: p.linkURL })
    // main refuses other schemes too (parseAllowedExternalUrl); not offering it beats a dead item
    if (WEB_URL.test(p.linkURL)) out.push({ kind: 'openLink', url: p.linkURL })
  }
  // data: URLs are whole images inline; copying one as an "address" would flood the clipboard
  if (p.mediaType === 'image' && p.srcURL && !p.srcURL.startsWith('data:')) out.push({ kind: 'copyImage', url: p.srcURL })
  if (p.isEditable) {
    if (p.editFlags.canCut) out.push({ kind: 'cut' })
    if (p.editFlags.canCopy) out.push({ kind: 'copy' })
    if (p.editFlags.canPaste) out.push({ kind: 'paste' })
  } else if (p.selectionText.trim()) {
    out.push({ kind: 'copyText', text: p.selectionText })
  }
  return out
}
