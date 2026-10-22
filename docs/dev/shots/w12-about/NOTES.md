# w12 About page (T28)

The PNGs are not gitignored (no .gitignore rule covers them), but none are saved in this folder yet, so only this file is tracked. The shots below are still to be taken and committed here. 1440x900, Night and Day, dev profile.

## Before (`before/`, source of 73fe2514)
- `settings-advanced-<theme>.png`: Settings › Advanced scrolled to the info card (app name, version, CLI versions, Host, accounts, update) at the bottom of a group of unrelated rows.

## After (`after/`)
- `settings-advanced-<theme>.png`: Advanced without the info card.
- `settings-about-<theme>.png`: the About group, last in the nav. App name with mark, Version, Build version with Copy, CLI versions, Host, accounts, Update (a release build also shows the Update channel Select), Crash reports (Ask / Never), License (Personal build), Open source licenses (View).
- `settings-licenses-night.png`: the licenses window with `react` picked: search, count, list, full text. Taken after `node scripts/gen-licenses.mjs`; without `build/licenses.json` it shows "The license list is not generated yet" and the command.

## Notes
- The shots were taken in Advanced mode (it shows the CLI, Host and accounts rows); simple mode shows name, versions, update, crash reports, license and licenses.
- This dev build is made from a checkout, so the Update row is the "manual" note and the channel row is hidden; the channel Select only applies to a release build (AUTO_UPDATE and not the source channel).
