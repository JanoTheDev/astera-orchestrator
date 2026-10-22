/**
 * The shortcut registry and key matching.
 *
 * Rather than hardcoding the bindings into conditionals, they are gathered into a list of actions so the
 * user can change them in settings.
 *
 * Matching is **based on `e.code`**. `e.key` becomes a Hangul jamo while an IME is composing, and it splits
 * into 'e'/'E' depending on Shift, which makes the comparison fragile. `e.code` is the physical key, so both
 * problems disappear.
 *
 * The stored string and the displayed string are the same (`Ctrl+Shift+E`) — keybindings.json still reads
 * when a human opens it, and the settings screen and the docs can use the same notation.
 * On macOS the primary modifier is Cmd (see makeActions). The stored notation is still `Cmd+W`-shaped.
 */

import { KEYED_PAGES } from '../ui/pages'

export type Chord = { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; code: string }

export type ActionId =
  | 'explorer.toggleMode'
  | 'explorer.closeFileTab'
  | 'explorer.cyclePreview'
  | 'sidebar.home'
  | 'sidebar.jobs'
  | 'sidebar.howItWorks'
  | 'sessionTab.prev'
  | 'sessionTab.next'
  | 'pane.splitRight'
  | 'pane.splitDown'
  | 'pane.focusLeft'
  | 'pane.focusRight'
  | 'pane.focusUp'
  | 'pane.focusDown'
  | 'run.run'
  | 'run.stop'
  | 'run.rerun'
  | 'run.selectConfig'
  // W3-B command bar
  | 'command.open'
  | 'command.talk'
  // W9-D: the search key, an alias of command.open (one box)
  | 'search.open'
  // W7-F (#84): the quick tab switcher
  | 'tabs.switcher'
  // T13: reopen the newest of Recently closed
  | 'tabs.reopenClosed'
  // W9-E: the New modal (DESIGN §5)
  | 'new.open'
  // W6-F: open the Nth project workspace
  | `workspace.project${WorkspaceSlot}`
  // W9-B: Ctrl+1…6 open the top bar's pages
  | `page.${KeyedPage}`
  // W9-K: a new window (DESIGN.md §1a)
  | 'window.new'
  // T30: the in-app help panel
  | 'help.open'

/** W6-F: the project workspaces with a key of their own, the first nine in the switcher. */
export type WorkspaceSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export const WORKSPACE_SLOTS: readonly WorkspaceSlot[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/** W9-B: the pages with a key of their own (core/ui/pages.ts KEYED_PAGES). */
export type KeyedPage = (typeof KEYED_PAGES)[number]

export type ActionSpec = {
  id: ActionId
  /** The default bindings. The order here is the display order */
  defaults: string[]
  /** The settings-screen wording (an i18n key) */
  descKey: string
  /** W6-F: the wording's params, for actions that share one key (the workspace slots) */
  descParams?: Record<string, number>
  /**
   * Does this action yield while xterm has focus. It differs per action — closing a file tab (Ctrl+W) yields
   * because the terminal's 'delete previous word' takes priority, while the mode toggle is intercepted even
   * over the terminal. This rule has to travel with the action even when the user changes the key, so it
   * lives here rather than on the binding.
   */
  yieldsToTerminal: boolean
}

/**
 * The per-platform action list.
 *
 * **Why a factory instead of a constant:** macOS uses Cmd for app shortcuts. That isn't just taste —
 * this app's primary screen is a terminal, and Ctrl combos need to pass through xterm to the shell
 * (readline, claude itself); if the app swallows them at the capture stage, that functionality dies.
 * Cmd, by contrast, is safely the app's own since the shell never uses it.
 *
 * yieldsToTerminal differs per platform for the same reason. On win32, Ctrl+W yields because the
 * terminal's 'delete previous word' takes priority, but Cmd+W has no competitor, so there's no
 * reason to yield.
 */
export function makeActions(platform: string): readonly ActionSpec[] {
  const mac = platform === 'darwin'
  /** The app shortcuts' primary modifier. mac=Cmd, everything else=Ctrl */
  const M = mac ? 'Cmd' : 'Ctrl'
  return [
    {
      id: 'explorer.toggleMode',
      // Ctrl+Tab used to be the first default here. It moved to sessionTab.next once the editor tab bar
      // began holding sessions as well as files: switching tabs is the frequent action and Ctrl+Tab is
      // what every browser and editor binds it to, while switching modes happens a handful of times a
      // session. Ctrl+Shift+E was already the second default, so nothing was lost.
      defaults: [`${M}+Shift+E`],
      descKey: 'shortcut.explorer.toggleMode',
      yieldsToTerminal: false
    },
    {
      id: 'explorer.closeFileTab',
      defaults: [`${M}+W`],
      descKey: 'shortcut.explorer.closeFileTab',
      // On win32, Ctrl+W yields to the terminal's 'delete previous word'. On mac, Cmd+W has no competitor.
      yieldsToTerminal: !mac
    },
    {
      id: 'explorer.cyclePreview',
      defaults: [`${M}+Shift+V`],
      descKey: 'shortcut.explorer.cyclePreview',
      // Ctrl+Shift+V(mac 은 Cmd+Shift+V) 는 경쟁자가 없지 않다 — TerminalView 의 붙여넣기 매칭이
      // v/V 와 clipMod 만 보고 e.shiftKey 를 확인하지 않아(복사 쪽 매칭과 다르게), 이 조합이 터미널의
      // 붙여넣기이기도 하다. Linux·Windows Terminal 에서 Ctrl+Shift+V 는 표준 터미널 붙여넣기 조합이기도
      // 하다. 마크다운 프리뷰 모드 순환에 터미널 입력을 가로챌 이유가 없으므로 양보한다.
      yieldsToTerminal: true
    },
    // The two sidebar views the rail can open. There is no explorer entry beside them: Ctrl+Shift+E
    // switches the explorer's mode rather than opening it, so the file tree has no "open me" key and
    // adding one was left out of this change.
    {
      id: 'sidebar.home',
      // 같은 Ctrl+Shift+<글자> 가족. A 는 Accounts 이고, 이 화면이 담는 것이 계정과 히스토리다.
      // DevTools 가 잡는 Ctrl+Shift+I·F12 와도, 이미 쓰는 E·J·H·V 와도 겹치지 않는다.
      defaults: [`${M}+Shift+A`],
      descKey: 'shortcut.sidebar.home',
      // 사이드바 뷰를 여는 것은 셸이 읽는 무엇과도 다투지 않는다 — 나머지 셋과 같은 판단.
      yieldsToTerminal: false
    },
    {
      id: 'sidebar.jobs',
      // Ctrl+Shift+<letter> is the family this app already uses for sidebar work (Ctrl+Shift+E), and
      // J and H are clear of the DevTools accelerators main/index.ts binds (Ctrl+Shift+I, F12).
      defaults: [`${M}+Shift+J`],
      descKey: 'shortcut.sidebar.jobs',
      // Opening a sidebar view competes with nothing a shell reads — the same judgement
      // explorer.toggleMode makes.
      yieldsToTerminal: false
    },
    {
      id: 'sidebar.howItWorks',
      defaults: [`${M}+Shift+H`],
      descKey: 'shortcut.sidebar.howItWorks',
      yieldsToTerminal: false
    },
    {
      id: 'sessionTab.prev',
      // Ctrl, not `${M}`, on both platforms: Cmd+Tab is the macOS application switcher, intercepted by
      // the window server before the app ever sees it. Ctrl+Tab is free there and is what win32 uses
      // anyway, so one literal covers both. PageUp/PageDown stay as a second default — they were the
      // shipped binding and session mode's users have them in their fingers.
      defaults: ['Ctrl+Shift+Tab', `${M}+PageUp`],
      descKey: 'shortcut.sessionTab.prev',
      yieldsToTerminal: false
    },
    {
      id: 'sessionTab.next',
      // See sessionTab.prev for why this is Ctrl rather than `${M}`.
      defaults: ['Ctrl+Tab', `${M}+PageDown`],
      descKey: 'shortcut.sessionTab.next',
      yieldsToTerminal: false
    },
    {
      id: 'pane.splitRight',
      defaults: [`${M}+\\`],
      descKey: 'shortcut.pane.splitRight',
      yieldsToTerminal: false
    },
    {
      id: 'pane.splitDown',
      defaults: [`${M}+Shift+\\`],
      descKey: 'shortcut.pane.splitDown',
      yieldsToTerminal: false
    },
    {
      id: 'pane.focusLeft',
      defaults: [`${M}+Shift+←`],
      descKey: 'shortcut.pane.focusLeft',
      yieldsToTerminal: false
    },
    {
      id: 'pane.focusRight',
      defaults: [`${M}+Shift+→`],
      descKey: 'shortcut.pane.focusRight',
      yieldsToTerminal: false
    },
    {
      id: 'pane.focusUp',
      defaults: [`${M}+Shift+↑`],
      descKey: 'shortcut.pane.focusUp',
      yieldsToTerminal: false
    },
    {
      id: 'pane.focusDown',
      defaults: [`${M}+Shift+↓`],
      descKey: 'shortcut.pane.focusDown',
      yieldsToTerminal: false
    },
    // The run shortcuts are F-key combinations, and the same on every platform. The Cmd/Ctrl split
    // above exists because Ctrl combos must reach the shell through xterm; F-keys have no such
    // problem anywhere, so there is nothing here to vary. IntelliJ's macOS default for Run — Ctrl+R —
    // is deliberately not used: it is the terminal's reverse-history search. On macOS these need Fn
    // unless "Use F1, F2, etc. as standard function keys" is on; the settings screen is the answer to
    // that, not a mac-only default that collides with the shell.
    //
    // None of the four yields to the terminal. "Run my project" has to work while the terminal has
    // focus — in an app whose main screen is a terminal, a run shortcut that needs you to click out
    // of it first is not a shortcut.
    {
      id: 'run.run',
      defaults: ['Shift+F10'],
      descKey: 'shortcut.run.run',
      yieldsToTerminal: false
    },
    {
      id: 'run.stop',
      defaults: ['Ctrl+F2'],
      descKey: 'shortcut.run.stop',
      yieldsToTerminal: false
    },
    {
      id: 'run.rerun',
      defaults: ['Ctrl+F5'],
      descKey: 'shortcut.run.rerun',
      yieldsToTerminal: false
    },
    {
      id: 'run.selectConfig',
      defaults: ['Alt+Shift+F10'],
      descKey: 'shortcut.run.selectConfig',
      yieldsToTerminal: false
    },
    // W3-B: the command bar (a conversation with the coordinator) and its push-to-talk. K for the command palette
    // habit, M for the microphone; neither is a DevTools accelerator nor one of the sidebar letters. Not yielded to
    // the terminal: the bar is where a person goes from a session, as the sidebar keys are.
    {
      id: 'command.open',
      defaults: [`${M}+Shift+K`],
      descKey: 'shortcut.command.open',
      yieldsToTerminal: false
    },
    {
      id: 'search.open',
      defaults: [`${M}+Shift+F`],
      descKey: 'shortcut.search.open',
      yieldsToTerminal: false
    },
    {
      id: 'command.talk',
      defaults: [`${M}+Shift+M`],
      descKey: 'shortcut.command.talk',
      yieldsToTerminal: false
    },
    // W7-F (#84): the quick tab switcher. P for the "go to anything" habit; Ctrl+Shift+P is no readline key, no DevTools
    // accelerator and no other default here. Not yielded: it is how a person leaves a terminal for another tab.
    {
      id: 'tabs.switcher',
      defaults: [`${M}+Shift+P`],
      descKey: 'shortcut.tabs.switcher',
      yieldsToTerminal: false
    },
    {
      // T13: the browser's own chord for "reopen closed tab". No CLI TUI reads Ctrl+Shift+T.
      id: 'tabs.reopenClosed',
      defaults: [`${M}+Shift+T`],
      descKey: 'shortcut.tabs.reopenClosed',
      yieldsToTerminal: false
    },
    {
      // W9-E: the New modal (DESIGN §1 keys). Ctrl+N is readline's next-history, so a focused console keeps it on
      // win32/linux (as Ctrl+W does); Cmd+N has no competitor on mac.
      id: 'new.open',
      defaults: [`${M}+N`],
      descKey: 'shortcut.new.open',
      yieldsToTerminal: !mac
    },
    // W6-F: Ctrl+Alt+1…9 opens the Nth project workspace. Ctrl, not `${M}`, everywhere, as the owner asked; Ctrl+Alt
    // with a digit is no readline or CLI key (riskyReasonKey) and no app shortcut, so it is not yielded either.
    ...WORKSPACE_SLOTS.map(
      (n): ActionSpec => ({
        id: `workspace.project${n}`,
        defaults: [`Ctrl+Alt+${n}`],
        descKey: 'shortcut.workspace.project',
        descParams: { n },
        yieldsToTerminal: false
      })
    ),
    // W9-B: `${M}+1…6`, as the top bar orders the pages. Over a console too: no CLI reads Ctrl+digit.
    ...KEYED_PAGES.map(
      (page, i): ActionSpec => ({
        id: `page.${page}`,
        defaults: [`${M}+${i + 1}`],
        descKey: `shortcut.page.${page}`,
        yieldsToTerminal: false
      })
    ),
    // W9-K: Ctrl+Shift+N opens a new window (DESIGN.md §1a). No readline or CLI key, and not yielded: it is the
    // window's, as the switcher keys are.
    {
      id: 'window.new',
      defaults: [`${M}+Shift+N`],
      descKey: 'shortcut.window.new',
      yieldsToTerminal: false
    },
    // T30: F1 opens the help panel. The same on every platform, like the run keys; no shell reads F1, so it works
    // over a console too.
    {
      id: 'help.open',
      defaults: ['F1'],
      descKey: 'help.shortcut',
      yieldsToTerminal: false
    }
  ]
}

/** Display token ↔ KeyboardEvent.code. A key that is not here cannot be bound (deliberately). */
const NAMED_CODES: Record<string, string> = {
  Tab: 'Tab',
  Enter: 'Enter',
  Space: 'Space',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Escape: 'Escape',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '\\': 'Backslash',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash'
}
const CODE_TO_TOKEN: Record<string, string> = Object.fromEntries(
  Object.entries(NAMED_CODES).map(([token, code]) => [code, token])
)

function tokenToCode(token: string): string | null {
  if (/^[A-Za-z]$/.test(token)) return `Key${token.toUpperCase()}`
  if (/^[0-9]$/.test(token)) return `Digit${token}`
  if (/^F([1-9]|1[0-2])$/.test(token)) return token
  return NAMED_CODES[token] ?? null
}

function codeToToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  return CODE_TO_TOKEN[code] ?? null
}

/** 'Ctrl+Shift+E' → chord. An unreadable notation returns null. */
export function parseChord(text: string): Chord | null {
  const parts = text.split('+').map((p) => p.trim())
  if (parts.length === 0 || parts.some((p) => p === '')) return null
  const keyToken = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1).map((m) => m.toLowerCase())
  if (modifiers.some((m) => !['ctrl', 'cmd', 'shift', 'alt'].includes(m))) return null
  const code = tokenToCode(keyToken)
  if (!code) return null
  return {
    ctrl: modifiers.includes('ctrl'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt'),
    meta: modifiers.includes('cmd'),
    code
  }
}

/** chord → 'Ctrl+Cmd+Alt+Shift+E'. Normalizes modifier order. */
export function formatChord(chord: Chord): string {
  const token = codeToToken(chord.code) ?? chord.code
  const parts: string[] = []
  if (chord.ctrl) parts.push('Ctrl')
  if (chord.meta) parts.push('Cmd')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  parts.push(token)
  return parts.join('+')
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/

/** Converts a key event to a chord. Modifier keys themselves are not accepted.
 *  (The rule that rejected Meta went away along with macOS support — there, Cmd is the primary modifier.) */
export function chordFromEvent(e: KeyboardEvent): Chord | null {
  if (MODIFIER_CODES.test(e.code)) return null
  if (!codeToToken(e.code)) return null
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, code: e.code }
}

export function matchesChord(chord: Chord, e: KeyboardEvent): boolean {
  return (
    e.ctrlKey === chord.ctrl &&
    e.metaKey === chord.meta &&
    e.shiftKey === chord.shift &&
    e.altKey === chord.alt &&
    e.code === chord.code
  )
}

export type Bindings = Record<ActionId, Chord[]>

/** Overlays user settings on top of the defaults. An empty array means 'off'; unreadable bindings
 *  and unknown actions are ignored. */
export function resolveBindings(
  overrides: Partial<Record<string, string[]>>,
  actions: readonly ActionSpec[]
): Bindings {
  const result = {} as Bindings
  for (const action of actions) {
    const override = overrides[action.id]
    const source = Array.isArray(override) ? override : action.defaults
    result[action.id] = source.map(parseChord).filter((c): c is Chord => c !== null)
  }
  return result
}

export function findActionForEvent(
  bindings: Bindings,
  e: KeyboardEvent,
  actions: readonly ActionSpec[]
): ActionId | null {
  for (const action of actions) {
    if (bindings[action.id]?.some((chord) => matchesChord(chord, e))) return action.id
  }
  return null
}

/** Collects cases where the same key is bound to more than one action. */
export function findConflicts(
  bindings: Bindings,
  actions: readonly ActionSpec[]
): { key: string; actions: ActionId[] }[] {
  const byKey = new Map<string, ActionId[]>()
  for (const action of actions) {
    for (const chord of bindings[action.id] ?? []) {
      const key = formatChord(chord)
      byKey.set(key, [...(byKey.get(key) ?? []), action.id])
    }
  }
  return [...byKey.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([key, actions]) => ({ key, actions }))
}

/**
 * Is this a key the CLI inside the terminal uses. If the app swallows it at the capture stage that
 * functionality dies, so this warns before saving. It doesn't block — the user knows their own
 * terminal habits (a deliberate decision).
 * mac's Cmd combos pass through automatically since chord.ctrl is false for them. The shell never uses Cmd.
 */
export function riskyReasonKey(chord: Chord): string | null {
  if (chord.code === 'Tab' && !chord.ctrl) return 'shortcut.risk.cliMode' // Tab·Shift+Tab
  if (!chord.ctrl || chord.alt) return null
  switch (chord.code) {
    case 'KeyC':
      return 'shortcut.risk.interrupt'
    case 'KeyD':
      return 'shortcut.risk.eof'
    case 'KeyA':
    case 'KeyE':
    case 'KeyK':
    case 'KeyU':
    case 'KeyW':
    case 'KeyB':
    case 'KeyF':
      return 'shortcut.risk.readline'
    case 'KeyR':
      return 'shortcut.risk.historySearch'
    case 'KeyL':
      return 'shortcut.risk.clear'
    case 'KeyJ':
      return 'shortcut.risk.newline'
    default:
      return null
  }
}
