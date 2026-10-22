# w12 history / code map / browser pane

## Changed
- HistoryBrowser: PageHeader (title, project count, refresh IconButton, account filter in the filters row). Project row = ghost Button (aria-expanded, chevron Icon). Session row = open-preview Button + resume IconButton (sibling). Unread dot has a name. Loading = Skeleton rows. Empty = EmptyState. Project menu = ui Menu (context mode, Shift+F10 / menu key via menuPointOf). Non-page mode keeps the fold toggle as a Button.
- UnderstandingView (code map sidebar): h2 head, EmptyState, row = Button (aria-current) with the "Write it up again" Button beside it; open-task Done/Cancel are Buttons.
- UnderstandingIcons: status icons (RECORD_ICON via Icon). RECORD_GLYPH characters stay only for the tab strip (PaneGrid), outside this Task.
- RecordDetail: all buttons are ui Buttons; chevron/close are Icons; narrow reference drawer has aria-expanded, a region name and closes on Esc.
- FlowDiagram: pickable steps are Buttons (aria-pressed) inside the same box. Edge lines stay SVG (diagram, not an icon).
- Browser pane, AppMirrorPane, AnnotationTray, AnnotationPopover: see "Browser pane and annotations" below.
- New keys (en/es/ja/ko): history.panel.count, history.panel.emptyHint, history.menu.label, history.entry.unread, hiw.empty.title, preview.design.sessionBusy, preview.menu.page.
- spinnerCss.test.ts: dropped the `.loading-dots` pin (the dots were replaced by Skeleton).

## Keyboard map
- History: Tab = refresh, account filter, then each project row; Enter/Space folds; inside an open project: session button, resume button. Context menu: Shift+F10 / menu key on a project; arrows, Home/End, Enter pick, Esc closes.
- Code map: Tab through rows (open button, then its retry button); Enter opens. Record pane: Edit, Write it up again, Reference (narrow), step buttons in the flow, decision/file buttons. Esc folds the reference drawer.
- Browser toolbar Tab order: back, forward, reload/stop, address, viewport select, rotate (when a preset is set), devtools, Design Mode, open external. Menus: arrows/Enter/Esc. Tray: Send, Copy, Clear, Collapse, then Edit/Delete per note. Esc closes only the note editor or comment box, not Design Mode.

## Moved controls
- Devtools and Design Mode are now icon-only (names/tooltips unchanged). Forward uses the back icon flipped.
- History refresh moved from the panel toolbar into the page header actions.

## Not changed
- Webview, mirror and annotation capture logic. browserSlot.ts untouched. Edit button in the record pane still only says "not ready yet" (kept; candidate to remove).

## Browser pane and annotations
- BrowserPane (`src/renderer/src/components/BrowserPane.tsx`): toolbar buttons are IconButtons with a label; viewport choice is a ui Select; the send-to-session and page menus are ui Menu. A busy session shows a spinning Icon with a name. Load error and empty state use EmptyState; retry is a Button.
- AppMirrorPane: Stop and Close are Buttons with Icons; the waiting and closed states are EmptyState.
- AnnotationTray: Send, Copy, Clear and Collapse are Button/IconButton; per-note Edit and Delete are IconButtons; the note editor's Save and Cancel are Buttons over a ui Textarea.
- AnnotationPopover: close is an IconButton; its action is a Button; the note is a ui Textarea.
- Left: no raw `<button>`, `<select>`, `<input>` or direct lucide import in these four files. Webview, mirror and annotation capture logic are untouched (see "Not changed"). No screenshot was taken for these panes in this pass.
