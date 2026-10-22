# House UI primitives

The shared building blocks of every page (docs/dev/DESIGN-W11.md §10). Props below come from the source files.

## Rules

- Import from the barrel: `import { Button, Chip } from '../ui'`. Never from a single file.
- No raw `<button>`, `<select>`, hand-made menu, modal, toast or empty state. Use `Button`, `IconButton`, `Card onClick`, `Tabs`, `Select`, `Menu`, `Modal`/`ConfirmDialog`, `toast`, `EmptyState`.
- An icon-only button needs a name: `IconButton` requires `label`; `Button` without children needs `aria-label`.
- One filled primary (`variant="primary"`) per view. Secondaries are `ghost` or `secondary` (DESIGN-W11 §2, §7).
- Tokens only in CSS: no colour literals, no raw px font sizes, no raw shadows in `primitives.css` (`var(--accent)`, `var(--text-dim)`, ...). `styles/noColourLiterals.test.ts` and `render.test.ts` fail on them.
- Icons through the registry: `<Icon name="settings" />` (`ICONS` in `Icon.tsx`). Lucide only; 16px in controls and rows, 14px in dense bars and chips. No emoji, no glyph characters.
- Status needs a second cue (icon, word or dot + label). Colour alone never carries meaning.
- Page skeleton: `PageHeader` (title, actions, filters) then content, with one `EmptyState` when empty.
- No new i18n keys for primitive labels: labels come from props. Screens pass their own translated strings (`t(...)`). Examples below use literals for brevity.

## Button

Action trigger. Variants: `primary` | `secondary` | `ghost` | `danger`; sizes `sm` | `md` | `lg`.
Props: `variant` (default `secondary`, or `ghost` when no children), `size` (default `md`), `icon`, `loading`
(spinner replaces icon, disables the button), plus all native button props. `type` defaults to `button`. Ref forwarded.
The file is `UiButton.tsx` (not `Button.tsx`, which would clash with shadcn's `button.tsx`).

```tsx
<Button variant="primary" icon={<Plus size={16} />} onClick={create}>New task</Button>
<Button variant="danger" loading={busy} onClick={remove}>Delete</Button>
```

## IconButton

Square icon-only button. Props: `icon` (lucide element), `label` (required: aria-label and title),
`size` (`sm` | `md`, default `md`), `variant` (`ghost` | `secondary`, default `ghost`), `active` (toggled-on state),
plus native button props except `children`. Ref forwarded.

```tsx
<IconButton icon={<Settings size={16} />} label="Settings" onClick={openSettings} />
<IconButton icon={<Filter size={14} />} label="Filters" size="sm" active={open} />
```

## Input, Textarea

Styled native controls (`Inputs.tsx`). Use bare in toolbars and filters; use `Field` in forms.
`Input` takes native input props (`type` defaults to `text`); `Textarea` takes native textarea props.
Both forward refs and accept `className`.

```tsx
<Input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
<Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
```

## Select

The ONE select: an ARIA listbox (select-only combobox) in `Select.tsx`; `Inputs.tsx` re-exports it. Focus stays on the
trigger; `aria-activedescendant` names the row.
Props (both forms): `value`, `placeholder` (default: the shared "not selected" string), `className` (add `dense` in panel
headers), `noCheck` (drop the trailing check, for lists whose icons already differ per row), `ariaLabel` / `aria-label`,
`id` (so a `<label htmlFor>` names it), `disabled`, `aria-describedby`, `aria-invalid`.
- List form (new code): `items: SelectOption[]` and `onChange(value: string)`. `SelectOption`: `value`, `label`,
  `group` (a run of items sharing one group gets one heading), `meta` (right-edge text), `icon` (node), `font`
  (CSS font-family for that row), `disabled`.
- Native form (kept for old callers): `<option>` / `<optgroup>` children and `onChange(e)` reading `e.target.value`.
  New code uses `items`.

Keyboard: Enter, Space, ArrowDown and ArrowUp open. Arrows, Home/End and typeahead move over enabled rows. Enter/Space
pick. Esc closes only the list. Tab closes and moves on.

```tsx
<Select ariaLabel="Sort" value={sort} onChange={setSort}
  items={[{ value: 'recent', label: 'Recent', icon: <Icon name="history" /> }, { value: 'name', label: 'Name', meta: 'A-Z' }]} />
<Select value={sort} onChange={(e) => setSort(e.target.value)}>
  <option value="recent">Recent</option>
</Select>
```

## Field

A labelled form control with optional hint and error, wired with `aria-describedby`, `aria-invalid`.
Props: `label`, `hint`, `error`, `className`, and a `kind` that picks the control:
- `kind="text"` (default) or `"number"`: native input props.
- `kind="textarea"`: native textarea props.
- `kind="select"`: renders `Select` with `options: SelectOption[]`, `value`, `placeholder`, `disabled`, `id`; `onChange(e)` reads
  `e.target.value`. `required` has no native validation on the listbox: show the missing value through `error`.
- `kind="toggle"`: renders `Switch`; `checked`, `onChange(checked: boolean)`.

```tsx
<Field label="Branch" hint="Created from main" value={b} onChange={(e) => setB(e.target.value)} />
<Field kind="select" label="Model" options={models} value={m} onChange={(e) => setM(e.target.value)} />
<Field kind="toggle" label="Auto-merge" checked={on} onChange={setOn} error={err} />
```

## Card

A surface for a group of content. Props: `tone` (`plain` | `focus` | `need` | `danger`, default `plain`),
`className`, `children`. Given `onClick` it renders as a `<button>` (keyboard reachable) and then accepts native button props.

```tsx
<Card tone="need" onClick={() => open(id)}>
  <strong>Review needed</strong>
</Card>
```

## Chip

Status or filter pill. Props: `tone` (`neutral` | `info` | `ok` | `warn` | `danger`, default `neutral`),
`dot` (leading status dot), `className`, `children`. Pair status tones with a word.

```tsx
<Chip tone="ok" dot>Running</Chip>
```

## Badge

Small count pill (unread count). Props: `tone` (same `ChipTone`), `className`, `children`. Renders what it gets:
the caller hides zero.

```tsx
{unread > 0 && <Badge tone="info">{unread}</Badge>}
```

## Tabs

Tab list. `variant="underline"` (default; `strip` is the old name) for sections of one view; `variant="segmented"` for a
scope choice in a PageHeader's filters row. Props: `items: { id, label, count?, disabled? }[]`, `value`, `onChange(id)`,
`variant`, `label` (aria-label). Arrow keys move focus.

```tsx
<Tabs variant="segmented" label="Scope" value={scope} onChange={setScope}
  items={[{ id: 'open', label: 'Open', count: 4 }, { id: 'done', label: 'Done' }]} />
```

## Menu

A list of actions, in two modes. `items: (MenuItem | 'separator')[]` in both.
`MenuItem`: `id?` (React key), `label`, `onSelect`, `icon?`, `danger?`, `disabled?`, `shortcut?` (shown as `Kbd`),
`checked?` (given, true or false: a checkable row; true draws the check).
- Trigger mode: a button that opens the list. Props: `label` (aria-label, required), `trigger` (props of the trigger `Button`:
  `icon`, `children`, `variant`...; `onClick` is reserved), `align` (`start` | `end`).
- Context mode: `at` (`{ x, y }` viewport point), `onClose`, optional `label`. The caller owns the open state. Get `at` from
  `menuPointOf(e)` in `onContextMenu`: it is the pointer, or under the focused element for Shift+F10 / the ContextMenu key.
  Call `e.preventDefault()` yourself.

Keyboard: arrows, Home/End and typeahead move; Enter/Space pick; Esc closes and returns focus to the opener; Tab closes;
an outside click closes.

```tsx
<Menu label="More" align="end" trigger={{ icon: <Icon name="more" /> }}
  items={[{ id: 'rename', label: 'Rename', onSelect: rename, shortcut: 'F2' }, 'separator',
          { id: 'del', label: 'Delete', danger: true, onSelect: del }]} />

const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
<div onContextMenu={(e) => { e.preventDefault(); setCtx(menuPointOf(e)) }}>row</div>
{ctx && <Menu at={ctx} onClose={() => setCtx(null)} label="Row actions" items={[{ label: 'Open', onSelect: open }]} />}
```

## Modal

Dialog with focus trap, Esc and backdrop close, focus restore. Props: `title`, `onClose`, `size` (`sm` | `md` | `lg`,
default `md`), `footer`, `closeLabel` (pass the i18n string), `children`. Mount it only while open.

```tsx
{open && (
  <Modal title="Delete task" size="sm" onClose={close} closeLabel={t('common.close')}
    footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" onClick={del}>Delete</Button></>}>
    This cannot be undone.
  </Modal>
)}
```

## EmptyState

The one empty state of a page. Props: `icon` (a lucide component, not an element), `title` (headline), `children`
(one sentence), `action` (the page's primary action).

```tsx
<EmptyState icon={Inbox} title="Nothing to review" action={<Button variant="primary">New task</Button>}>
  Finished work shows up here.
</EmptyState>
```

## PageHeader

Header of every page. Props: `title`, `subtitle` (count or one line), `actions` (right side: at most one primary,
rest ghost), `filters` (row below: segmented `Tabs`, `Chip`s, search), `leading` (back button or page icon), `className`.

```tsx
<PageHeader title="Tasks" subtitle="12 open"
  actions={<Button variant="primary" icon={<Plus size={16} />}>New task</Button>}
  filters={<Tabs variant="segmented" items={items} value={v} onChange={setV} />} />
```

## Section

Collapsible block with a persisted open state (`localStorage` key `cm.section.<id>`). Props: `id` (required, unique),
`label`, `count`, `action`, `defaultOpen` (default `true`), `children`.

```tsx
<Section id="tasks-done" label="Done" count={7} defaultOpen={false}>{rows}</Section>
```

## Kbd

A key chord, one cap per `+`-separated key. Props: `children` (a string such as `"Ctrl+K"`), `className`.
`kbdKeys(chord)` splits a chord into its keys.

```tsx
<Kbd>Ctrl+K</Kbd>
```

## Tooltip

CSS-only hover/focus hint around one control. Props: `content`, `side` (`top` | `bottom`, default `bottom`),
`className`, `children`. Imported as `Tooltip` (file is `UiTooltip.tsx`). For plain text on an icon button,
`IconButton`'s `label` already sets the title; use `Tooltip` for richer hints (a shortcut, a second line).

```tsx
<Tooltip content={<>Search <Kbd>Ctrl+K</Kbd></>} side="bottom"><Button icon={<Search size={16} />} aria-label="Search" /></Tooltip>
```

## Meter

0 to 100 usage bar, tone from the usage-guard thresholds. Props: `value` (clamped), `label`, `className`.

```tsx
<Meter value={72} label="5h window" />
```

## Nav

Top-bar page tabs with arrow-key focus. Props: `items: { id, label, count? }[]`, `current`, `onSelect(id)`, `label`
(aria-label). Used by the shell; pages use `Tabs`.

```tsx
<Nav label="Pages" items={pages} current={page} onSelect={setPage} />
```

## Icon

Renders a lucide icon. Props: `name` (a key of `ICONS` in `Icon.tsx`; preferred) or `icon` (an imported lucide component, for a
glyph not in the registry yet; add the name to `ICONS` before using it on a page), `size` (`14` | `16` | `20`, default `16`), `label`
(makes it `role="img"` with that name; otherwise decorative), `className`.

```tsx
<Icon name="branch" size={14} />
<Icon name="warning" label="Failed" />
```

## Toast and ToastViewport

Transient messages. Call `toast.info | success | error(message, { action, onDismiss, ttlMs })` from `lib/toast`
(`action: { label, onClick }`; `ttlMs` makes an error close by itself). It returns the toast id; an action toast should
`dismiss(id)` when its action fires. Mount `ToastViewport` once, at the App root; it only subscribes to the store.
It is a polite live region. Timers pause while the pointer or focus is on it. Errors and action toasts never auto-dismiss
(info and success close after 4s). The close button is named by `common.toastDismiss`.

```tsx
toast.success('Saved')
toast.error('Merge failed', { action: { label: 'Retry', onClick: retry } })
// App root: <ToastViewport />
```

## ConfirmDialog

A yes/no question on `Modal`. The confirm button takes focus, so Enter confirms; Esc, the backdrop and the header close
dismiss. Props: `title`, `children`, `confirmLabel`, `cancelLabel`, `closeLabel`, `danger` (confirm becomes the danger
variant), `onConfirm`, `onCancel`, `onDismiss` (defaults to `onCancel`). App code normally does
`await confirmModal({ title, body, danger: true })` from `lib/confirm`, shown through `ui/ConfirmHost`.

```tsx
if (!(await confirmModal({ title: 'Delete task', body: 'This cannot be undone.', danger: true }))) return
```

## Switch

An on/off setting that applies at once (`role="switch"`, a native checkbox underneath; Space toggles). Props: `checked`,
`onChange(checked: boolean)`, plus input props except `type`. It needs a name: `<label htmlFor>`, a wrapping label or `aria-label`.

```tsx
<Switch aria-label="Auto-merge" checked={on} onChange={setOn} />
```

## Skeleton

Placeholder while content loads. Props: `shape` (`line` | `block` | `circle`, default `line`), `width`, `height` (any CSS
length), `className`. It is `aria-hidden`; mark the loading region `aria-busy`. The file is `UiSkeleton.tsx`.

```tsx
<div aria-busy="true"><Skeleton width="60%" /><Skeleton shape="block" height={80} /></div>
```

## Popover

A button that opens a panel under it, for panels like the usage meter or the notification bell. Use `Menu` for action lists.
Props: `open`, `onOpenChange`, `label` (aria-label of the panel), `trigger` (render-prop; spread the given `ref`,
`aria-haspopup`, `aria-expanded`, `onClick` on a button), `children`, `className`, `panelClassName`. Outside click and Esc
close (Esc refocuses the trigger); arrows move over rows marked `data-roving`.

```tsx
<Popover open={open} onOpenChange={setOpen} label="Usage" panelClassName="usage-panel"
  trigger={(p) => <IconButton {...p} icon={<Icon name="activity" />} label="Usage" />}>
  <Meter value={72} label="5h window" />
</Popover>
```

## Which one when

- Select: pick one value from a list in a form or toolbar. Menu: run an action. Popover: a panel of content. Tabs: switch the view.
- Modal: a task with its own content. ConfirmDialog (`confirmModal`): a yes/no question.
- Toast: an outcome that needs no place on the page. EmptyState: a page with nothing in it. Field `error`: a problem with one input.
- Switch: applies at once. Checkbox: applied later with a form.

## Vendored shadcn files

`button.tsx`, `dialog.tsx`, `textarea.tsx`, `tooltip.tsx`, `avatar.tsx`, `collapsible.tsx` and `skeleton.tsx` in this
folder are legacy. They stay only for their current importers; new code must not import them. Use `Button`,
`Modal`, `Textarea`, `Tooltip`, `Skeleton` and `Section` instead (no house avatar exists yet; the house `Skeleton` is in `UiSkeleton.tsx`).

Current importers (under `src/renderer/src/components/`):

- `ui/button`: conversation/ChatRequestCard, conversation/QuestionCard, conversation/PendingBanner,
  assistant-ui/elements/tooltip-icon-button, tool-fallback.aui, thread.aui; also `ui/dialog.tsx` itself.
- `ui/collapsible`: conversation/ToolRow, assistant-ui/elements/reasoning, tool-fallback.aui, tool-group.aui.
- `ui/tooltip`: assistant-ui/elements/tooltip-icon-button, attachment.aui.
- `ui/dialog`: assistant-ui/elements/attachment.aui.
- `ui/avatar`: assistant-ui/elements/attachment.aui.
- `ui/textarea`: assistant-ui/elements/tool-fallback.aui.
- `ui/skeleton`: assistant-ui/elements/thread.aui.

Tailwind stays for those files only. Delete a legacy file once its last importer moves to the house primitives.

## Advanced mode

`const [advanced, setAdvanced] = useAdvancedMode()` (`state/useAdvancedMode.ts`) is the one switch for power-user UI, off by default and kept in `localStorage` (`cm.advancedMode`).
Show only essentials while it is `false`; put technical rows and options behind it (the Start page's "More options" opens by default when it is `true`).

## Old paths (removed)

`components/Select.tsx`, `ContextMenu.tsx`, `ToastHost.tsx` and `toast.css` are deleted; `ConfirmHost` now lives in `ui/ConfirmHost.tsx`. `ui/oneOffs.test.ts` fails on a raw `<button>`, `<select>`, `role="menu"`/`"listbox"`, `window.confirm` or inline `<svg>` outside `components/ui`.

Still legacy, do not import in new code:
- `ui/Inputs` native `<select>` shape -> the `items` form of `Select`.
- Direct `lucide-react` imports in screens -> `Icon name="..."`.
- Vendored lowercase shadcn files (`button.tsx`, `dialog.tsx`, `skeleton.tsx`, `tooltip.tsx`, `textarea.tsx`...): assistant-ui only.
- The removed `.context-menu*` classes and `.toast-*` classes.
