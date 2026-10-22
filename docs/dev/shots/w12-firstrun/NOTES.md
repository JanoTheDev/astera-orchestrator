# First run on a machine with no CLIs (T29)

Dev app on a clean environment: `HOME` = empty temp dir, `PATH=/usr/local/bin:/usr/bin:/bin` (no `~/.local/bin`, so no
`claude`; no `codex` on this machine), `SHELL=/bin/sh`, fresh `ASTERA_PROFILE_DIR` and `--user-data-dir`, own debug port,
started with `astera heavy -- env -u ELECTRON_RUN_AS_NODE ... electron-vite dev --remoteDebuggingPort <port>`. Driven
over CDP with keyboard focus and Enter/Escape. The vendor installers were **not** run: `ASTERA_DEV_CLI_INSTALLER=<script>`
(dev only, ignored in a packaged app) swaps them for a stub that writes a fake `claude` into `$HOME/.local/bin`; the
stub fails once when `$HOME/.fail-once` exists. Temp dirs removed afterwards; the app was stopped.

| Shot | What it shows |
|---|---|
| 01-welcome | Fresh profile starts in onboarding, no blank screen, no toast. |
| 02-tools-nocli | Tools step: both CLIs with Install, "Neither is installed yet", git and gh detected and explained, Skip for now beside Next. |
| 03-command-shown | "Show command" reveals the exact command. |
| 04-installing | Installer running: spinner line, live output, buttons disabled. |
| 05-failed-retry | Stub failed: error text, output kept open, the button reads Retry. |
| 06-installed | Retry succeeded: card says Installed, "Ready", no restart needed (PATH adopted in-process). |
| 07-accounts-skip | Accounts step with no CLI: says there is nothing to sign in to; Skip for now. |
| 08-done-missing | Done step names what is missing (no agent). |
| 09-app-with-banner | App opens (not a locked screen) with the dismissible banner. |
| 10-banner-opens-install-step | Banner Install reopens onboarding at Tools. |

Found while walking: with a shell the app has no profile file for (`SHELL=/bin/sh`, fish) the install was reported
"installed but cannot be found yet" and a restart does not help. `findAfterInstall` now answers the installed file, main
puts its folder on its own PATH for this run, and nothing is written to the shell file.

Not covered: git/gh *missing* states were not walked (both are in `/usr/bin` here); they are the same row with the
"was not found" text. Windows and macOS were not run.
