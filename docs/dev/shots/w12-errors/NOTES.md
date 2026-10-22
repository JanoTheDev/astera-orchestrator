# w12 errors and empty states

## Changed
- `ErrorBoundary.tsx` now renders the new `ErrorScreen.tsx` (icon, plain-words headline and sentence, details block, Reload / Copy details / Report). Built from ui primitives only; no raw `<button>`.
- `ErrorScreen`: Reload is the one filled primary and takes focus on mount. Copy details writes name, message and stack to the clipboard and shows "Copied" for 2 s. Report is a ghost button and opens nothing yet: `onReport` is the hook for the later crash-report Task.
- `ui/EmptyState.tsx`: two additive optional props, `detail` (block under the sentence) and `role` (`alert` | `status`). Existing callers unchanged.
- `search/errorScreen.css`: tokens-only styles for the screen and details block (imported by ErrorScreen).
- `search/useHostWaiting.ts` and `search.css`: no UI lives there (hook only; `.ss-badge` is unused). Untouched.
- Strings (en/es/ja/ko, `errors.ts`): `app.renderErrorWhat`, `...Details`, `...Copy`, `...Copied`, `...Report`.

## Keyboard map
Tab order: Reload, Copy details, Report, then the details block (focusable so it scrolls with arrow keys). Enter/Space activate. Focus ring from the shared `ui-btn` :focus-visible. No popovers or dialogs, so no Esc behaviour.

## Moved controls
None. Reload kept (now filled primary, left of Copy details).

## EmptyState README text (not written, to avoid touching other sections)
"Error states: pass `role="alert"`, a warning icon, a plain-words title, one sentence, and `detail` for technical text. One filled primary action."
