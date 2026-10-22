# House UI primitives

The shared building blocks of every page (docs/dev/DESIGN-W11.md §10). Props below come from the source files.

## Rules

- Import from the barrel: `import { Button, Chip } from '../ui'`. Never from a single file.
- No hand-rolled `<button>` with its own CSS. Use `Button`, `IconButton`, `Card onClick`, `Tabs`, `Menu`.
- One filled primary (`variant="primary"`) per view. Secondaries are `ghost` or `secondary` (DESIGN-W11 §2, §7).
- An icon-only button needs a name: `IconButton` requires `label`; `Button` without children needs `aria-label`.
- Colours only through tokens (`var(--accent)`, `var(--text-dim)`, ...). `styles/noColourLiterals.test.ts` fails on hex/rgb literals in CSS.
- Icons are lucide only: 16px in controls and rows, 14px in dense bars and chips. No emoji, no glyph characters.
- Status needs a second cue (icon, word or dot + label). Colour alone never carries meaning.
- Page skeleton: `PageHeader` (title, actions, filters) then content, with one `EmptyState` when empty.
- All visible text goes through i18n (`src/core/i18n/messages`). Examples below use literals for brevity.

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

## Input, Select, Textarea

Styled native controls (all in `Inputs.tsx`). Use bare in toolbars and filters; use `Field` in forms.
`Input` takes native input props (`type` defaults to `text`); `Select` takes native select props, options are
`<option>` children; `Textarea` takes native textarea props. All forward refs and accept `className`.

```tsx
<Input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
<Select value={sort} onChange={(e) => setSort(e.target.value)}>
  <option value="recent">Recent</option>
</Select>
<Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
```

## Field

A labelled form control with optional hint and error, wired with `aria-describedby`, `aria-invalid`.
Props: `label`, `hint`, `error`, `className`, and a `kind` that picks the control:
- `kind="text"` (default) or `"number"`: native input props.
- `kind="textarea"`: native textarea props.
- `kind="select"`: `options: { value: string; label }[]` plus native select props.
- `kind="toggle"`: `checked`, `onChange(checked: boolean)` (a switch).

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

A button that opens a list of actions. Props: `items: (MenuItem | 'separator')[]`, `label` (aria-label, required),
`trigger` (props of the trigger `Button`: `icon`, `children`, `variant`...; `onClick` is reserved), `align` (`start` | `end`).
`MenuItem`: `id`, `label`, `onSelect`, `icon?`, `danger?`, `disabled?`, `shortcut?` (shown as `Kbd`), `checked?`
(makes it a checkable row). Esc and outside click close it.

```tsx
<Menu label="More" align="end" trigger={{ icon: <MoreHorizontal size={16} /> }}
  items={[{ id: 'rename', label: 'Rename', onSelect: rename, shortcut: 'F2' }, 'separator',
          { id: 'del', label: 'Delete', danger: true, onSelect: del }]} />
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

Renders a lucide icon. Props: `icon` (the imported component), `size` (`14` | `16` | `20`, default `16`), `label`
(makes it an image with that name; otherwise decorative), `className`. Raw lucide (`<Plus size={16} />`) is fine inside
a `Button`'s `icon`.

```tsx
<Icon icon={GitBranch} size={14} />
```

## Vendored shadcn files

`button.tsx`, `dialog.tsx`, `textarea.tsx`, `tooltip.tsx`, `avatar.tsx`, `collapsible.tsx` and `skeleton.tsx` in this
folder are legacy. They stay only for their current importers; new code must not import them. Use `Button`,
`Modal`, `Textarea`, `Tooltip` and `Section` instead (no house avatar or skeleton exists yet).

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
