# Licensing seam

Where paid licensing will plug in. **No licensing code exists.** There is no license key, no entitlement check, no
activation, no network call for licensing, and no paywall. The app runs fully without any of them. This page marks the
place to add them and the rules they must follow.

## What exists today

- **The About page License row.** `src/renderer/src/components/settings/AboutSettings.tsx`, the row wrapped in
  `SettingRow a="license"` (Settings › About). It shows the label `about.license` (“License”) and a fixed value
  `about.license.personal` (“Personal build”). Nothing is read or checked. Its comment says:
  “The seam for paid licensing: docs/product/licensing.md names this row. Nothing is checked today.”
- **The Apache-2.0 license of Astera itself** (`LICENSE`, README). This is the project's license, not a product license.
  It is unrelated to the row above.
- **Open source licenses** (About › Open source licenses, `LicensesView.tsx`). A list of the licenses of the software
  Astera ships. This is a notice, not an entitlement.

## Where a license check would sit

1. **One module for entitlements.** Put the whole decision in one place, for example
   `src/core/license/entitlement.ts`. This file does not exist yet. It should export one pure function that answers
   “is feature X enabled, and why not” from a stored value and a clock. Keep it free of I/O so it can be tested with
   vitest, as the other `src/core` modules are.
2. **Storage.** Keep the license value in the app's profile folder, next to `app-settings.json`, written through the
   same store pattern that `src/main/appSettingsStore.ts` uses. Do not store it in the renderer.
3. **The About row reads the module.** `AboutSettings.tsx` would show the tier and state from the module instead of the
   fixed string `about.license.personal`. Translations go through i18n in en, es, ja and ko, as every user-facing string
   does.
4. **Gates run on the Host, not in the window.** The Host drives Jobs even while the app is closed (see
   `docs/dev/CONTEXT.md` rule 7). A gate that is only in the renderer can be bypassed by the Host's command path. Any
   check that stops a paid feature must hold on the Host's command path, and the renderer only shows the result.
5. **Fail towards the user's data, not towards a lockout.** When the check cannot run (no network, a bad file), the
   answer should not remove access to the user's own data. Decide the grace rule before the first paid feature ships.

## What must never be gated

These stay free in every tier, with or without a license:

- **The user's local data.** Projects, plans, Tasks, sessions, worktrees, files, Local History, history, settings and
  the profile folder. Reading, writing, opening and deleting them, and the app starting with them.
- **Export.** Any export added later, and copying text from the app. Today there is no export feature (see
  [known-limits.md](known-limits.md)); a future one must not be gated.
- **Crash-report consent.** The choice Ask or Never in About, the error prompt, and the report file. A person must
  always be able to decline a report, and must not need a license to read or send one.
- **The Open source licenses view** and the notices it shows.
- **In-app help, onboarding and the About page itself,** including this row.
- **Safety and the permission prompt.** Turning on or off permission checks, and the stop at a permission prompt, are not
  features to sell.

## Rules for the change

- Add the check once, in the module above. Do not add ad-hoc `if (paid)` checks across screens.
- Ask the owner before you choose: the vendor, the offline grace period, and where the key is entered. These are
  material choices and are not decided here.
- A new network call for licensing is a new item for [known-limits.md](known-limits.md) under Network use. Name the host
  and what is sent. Never send the user's e-mail or account credentials to a license server.
- Update this page and [features.md](features.md) when the first paid feature lands.
