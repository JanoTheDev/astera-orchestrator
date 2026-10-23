# w12 About page (T28)

The PNGs are committed in this folder. 1440x900, Night and Day, dev profile, Advanced mode. `after/` also holds the same screens at `<size>-<theme>-settings-<name>.png` (1440x900 and 1024x640), taken by the after-shots Task (T33).

## Before (`before/`, built from commit 73fe2514)
The 73fe2514 build was run from a temporary checkout (dev server, same dev profile folder, Advanced mode on) and Settings › Advanced was scrolled to the info card.
- `settings-advanced-<theme>.png`: Settings › Advanced scrolled to the info card (app name, version, CLI versions, Host, accounts, update) at the bottom of a group of unrelated rows.

## After (`after/`)
- `settings-advanced-<theme>.png`: Advanced without the info card.
- `settings-about-<theme>.png`: the About group, last in the nav. App name with mark, Version, Build version with Copy, CLI versions, Host, accounts, Update (a release build also shows the Update channel Select), Crash reports (Ask / Never), License (Personal build), Open source licenses (View).
- `settings-licenses-night.png`: the licenses window with `react` picked: search, count, list, full text. Taken after `node scripts/gen-licenses.mjs`; without `build/licenses.json` it shows "The license list is not generated yet" and the command.

## Notes
- The shots were taken in Advanced mode (it shows the CLI, Host and accounts rows); simple mode shows name, versions, update, crash reports, license and licenses.
- This dev build is made from a checkout, so the Update row is the "manual" note and the channel row is hidden; the channel Select only applies to a release build (AUTO_UPDATE and not the source channel).

## Shot log (T33)
- `before/settings-advanced-<night|day>.png`: taken from the 73fe2514 build, as described above. `w12-before/about/` (the general-advanced page) is the older stand-in and is not needed for this comparison.
- `after/settings-advanced-<theme>.png`, `after/settings-about-<theme>.png`, `after/settings-licenses-night.png`: copies of the 1440x900 shots named in the list above. `node scripts/gen-licenses.mjs` was run first (289 entries), so the licenses window shows the list and the text of `react`.
- The licenses text in the window wraps the source file's own hard line breaks, so some lines break twice. It reads, but a `white-space: pre-wrap` box that unwraps single line breaks would be tidier. Left: `licenses.css`/`LicensesView.tsx` redesign, not a small fix.
