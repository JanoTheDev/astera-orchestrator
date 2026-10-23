# Remote Runtime

Remote Runtime lets one machine run Jobs and sessions for another. The machine that does the work is the
**Runtime**; the machine you type on is the **controller**. Claude, Codex, worktrees, checks, repairs and recovery stay
on the Runtime, and you drive the work from the Astera app, the `astera` command or MCP on the controller. Jobs keep
running on the Runtime when the controller sleeps, shuts down or loses its network: the controller only sends commands
and reads what happened.

## What it costs

Astera does not require a hosted relay or cloud service for Remote Runtime. You provide the machine and private network
connection. The only costs are the ones you choose: a VPS or cloud machine if the Runtime is one, a VPN service if you
use one, and the Claude or Codex subscriptions or API use the Runtime's accounts already have. There is no Astera
server fee.

## How it differs from MCP over HTTP

MCP over HTTP (Settings › Integrations › CLI) lets an MCP client on another machine call this machine's tools. It is plain HTTP: its
`lan` mode is not a secure remote path, and the docs for it say so. Remote Runtime is the secure path: a pinned TLS
key, a one-time pairing, a token per controller that can be revoked, and a list of what a controller may do that the
Runtime checks on every call.

## What it promises

1. A network loss, a laptop that sleeps or shuts down, a closed app or command, and a Gateway restart never change a
   Job's lifetime.
2. While Remote is on, the Runtime's Host stays up, including with only a scheduled Job or a Run waiting on a question.
   A schedule time that passes while the Host is down is skipped, not fired late.
3. A rebooted Runtime machine is back when its user logs in (with one of the OS recipes below), or after
   `astera runtime start`. A crashed Host is back at once when it runs under `astera runtime serve` with an OS
   supervisor.
4. After a Host restart, lost workers, repairs and interrupted checks are recovered by the Host itself, with no app
   open anywhere. Live terminal sessions do not survive a Host restart.
5. A controller that reconnects sees the Runtime's current state; a remote terminal that reconnects shows the same
   screen it would have shown had it stayed attached, or says plainly that it cannot.
6. A retried change never runs twice. When the Runtime cannot prove whether the first attempt ran, the answer is
   `RUNTIME_OUTCOME_UNKNOWN`, never a second run.

Notifications for a Job on a Runtime follow the Runtime machine's own Slack settings, not the controller's.

## Where it runs

The Runtime is a machine with Astera installed: Windows, macOS, or Ubuntu and Debian Linux from the `.deb`, with or
without a desktop. On a Linux server with no X11 or Wayland, everything a Runtime runs (the `astera` command,
`astera runtime serve`, the Host and the Gateway) is the app's own binary run as Node (`ELECTRON_RUN_AS_NODE=1`), which
opens no window and needs no display. `astera runtime setup` installs the command line there and
`astera accounts login --new` signs accounts in from a terminal, so no desktop session is needed to set it up. How that
was checked: neither the command line nor the Host loads Electron's window code, and a test starts the Host plan `serve`
uses with `DISPLAY` and `WAYLAND_DISPLAY` unset (`src/cli/runtime/setup.test.ts`, "headless Linux"); the `.deb` still
installs the desktop libraries the binary links against. Once set up, the OS recipes below keep it running across
reboots without anyone logged in on Linux, and from your login on Windows and macOS. Any of the three can be a
controller.

Use a private network: your LAN, a VPN, or Tailscale. Do not forward the Runtime's port to the internet. Astera offers
no relay and opens no port for you.

## Add a machine from this app

The quickest setup, from the computer you already use: one command, or Settings › Integrations › Remote Runtimes ›
**Add a machine** › **Over SSH (one step)**. It needs only that `ssh user@host` works from here with your key or agent;
Astera uses the system `ssh` and `scp` in BatchMode and never asks for or keeps a password.

```sh
astera machines add me@box                      # Linux: uploads the newest dist-installer/astera-*-amd64.deb
astera machines add me@win --installer Astera-Setup.exe --full-control
```

Flags: `--port <n>` (SSH port, default 22), `--installer <path>` (required for Windows; build it with `npm run dist:win`,
the repository has no releases), `--name <n>`, `--listen <ip>` or `--tailscale`, `--full-control` (needed to add
projects there). It finds out the OS, uploads the installer with the matching `scripts/install-runtime.*` script, runs
it, pairs with the `ASTERA_PAIR=` line it prints and pings the machine, one line per step, then prints
"Machine <name> is ready". A failure names the step, the end of what the machine wrote (secrets removed) and the fix.
On Linux the install asks sudo for the password in your terminal; the app has no terminal, so from the app the machine's
user needs sudo without a password, or run the command instead. Running it again upgrades the machine and pairs again
only when the old pairing no longer answers.

Then use it:

- **Projects**: `astera --runtime <name> projects add --clone <git url> [--path <abs path>]`, or **Add project** on the
  machine's row. The machine clones with its own git credentials (into `~/astera-projects/<name>` without `--path`) and
  registers it. Only a full-control pairing may.
- **Accounts**: **Sign in account** on the machine's row opens a terminal tab on that machine running
  `astera accounts login --new` (full-control pairings); open its login link and finish in your browser. Its accounts
  show under the row. A machine too old for that gets the command copied, to run in a terminal there.
- **Tabs**: New console lists This computer, then each machine, and remembers the last pick per project.

### Bring your setup

`astera machines add` ends by bringing this computer's setup over (T12c). It lists exactly what moves and asks once
(`--yes` skips the question); `--only` / `--skip` take `github,git,accounts,projects`, `--projects all|<id,...>`
narrows the projects. On its own, for a machine added before, or again later:

```
astera machines migrate <name> [--only ...] [--skip ...] [--projects ...] [--dry-run] [--yes] [--target user@host --port n]
```

In the app it is the **Bring my setup** step after **Add a machine over SSH**, and **Copy my setup again** on the row of
a machine added that way (its SSH address is kept in `<profile>/runtimes/machines.json`). Each item ends in one line:
ok, needs a one-time login, skipped (and why) or failed (and the fix).

- **GitHub**: `gh auth token` here, `gh auth login --with-token` there (gh installed with apt or winget when missing),
  then `gh auth setup-git`, so git over HTTPS uses that login. No SSH private key moves; a GitHub SSH origin is cloned
  over HTTPS instead.
- **Git identity**: the global `user.name` and `user.email`.
- **Accounts**: every Claude and Codex account is made there with the same label, colour and provider, in a new config
  folder of its own, through `astera accounts import` (the login file written owner-only: 0600, or an owner-only ACL on
  Windows, via a temp file that never outlives the write). Then the machine's own login check (`accounts list` over the
  pairing) decides each line.
- **Projects**: each project with an `origin` is cloned to `~/astera/projects/<name>` (Windows
  `%USERPROFILE%\astera\projects\<name>`) with the migrated gh login, put on its default branch, registered, and given
  its settings (delivery, delivery branch, auto-approve, hands-off, concurrency, review rounds, replan, prompts folder,
  auto-projects, grants, coordinator model, origin sync). A project without a remote is skipped with that reason, and so
  is a sub-project (its workspace is the repository that moves). Uncommitted work never moves; the plan says which projects have some.
- **Not carried**: a project's account and run configuration (their ids are this computer's), window layout, the
  app-wide auto-clean switch and account preferences (the machine keeps its own defaults).

**Why Claude logins are not copied.** Claude Code (measured on 2.1.301) keeps an OAuth access token and a *rotating*
refresh token in `.credentials.json` (`accessToken`, `refreshToken`, `expiresAt`, `refreshTokenExpiresAt`, `scopes`):
a refresh returns a new pair and the old refresh token dies (the CLI tracks `known_dead_refresh_token`). Two machines
sharing one copy would each refresh it, and the first refresh logs the other out, so copying would log you out here.
It was not tried with a throw-away copy, because that test would rotate and kill the real login. So each Claude
account gets its own long-lived token from `claude setup-token` (one browser approval per account, run here in your
terminal; sign in to the browser as that account), written there as a credentials file with no refresh token. Codex's
ChatGPT login rotates the same way and has no long-lived token, so a Codex account is made there and signed in once
in your terminal (`codex login --device-auth` on the machine). From the app, which has no terminal, both are reported
as **needs a one-time login**; run `astera machines migrate <name> --only accounts` in a terminal to finish them.

**Security.** The GitHub token and the setup-tokens travel only on the SSH channel's standard input: never in a
command line (`ps`), an environment variable of a long-lived process, a log, the activity feed, or a file left behind;
every line shown has them removed. `--dry-run` lists the plan without reading a secret or touching the machine. Both
commands, and `accounts import`, are refused inside an agent session (`ASTERA_SESSION` is set).


The manual steps follow, for a machine this computer cannot reach over SSH.

## One-command setup

On the machine that will do the work, with the Astera installer copied onto it. The repository is private and has no
public download, so the installer comes from your controller (the Astera app there can upload it) or a file you copy.

Ubuntu or Debian, as the user the Runtime belongs to (not root; the script asks sudo for apt and linger):

```text
bash install-runtime.sh ./astera_<version>_amd64.deb --tailscale --full-control
```

Windows, in PowerShell as your own user (no administrator):

```text
powershell -ExecutionPolicy Bypass -File install-runtime.ps1 -Installer .\astera-<version>-setup.exe -Tailscale -FullControl
```

Both scripts are in `scripts/`. They install Astera, then run `astera runtime setup --yes` with the flags given, and
their last line is `ASTERA_PAIR=<pairing string>`: give that string to the controller (`astera runtimes add --pair -`)
and to nothing else, it carries a one-time code.

With Astera already installed, the command alone does the same:

```text
astera runtime setup [--listen <addr> | --tailscale] [--name <n>] [--full-control] [--yes] [--codex] [--json]
```

Each step prints `ok`, `skipped` (already there) or `failed` with the reason, so running it again changes nothing that
is in place:

1. **git**: installed with apt on Ubuntu and Debian, with winget on Windows; on macOS it says to install it.
2. **Node**: never installed. The Host runs on Astera's own runtime.
3. **Claude CLI** (and the Codex CLI with `--codex`): the vendor's own installer. On Windows its folder goes on your
   user Path, so the keep-alive task finds `claude`. Without `--yes` a missing package is a failed step that names the
   command to run.
4. **The `astera` command**: the same files as Settings › Integrations › CLI, in `~/.local/bin` or
   `%LOCALAPPDATA%\astera\bin`.
5. **Keep-alive**: the recipe for this OS below, written and started for you: a systemd user unit with linger on Linux,
   the Task Scheduler logon task on Windows, a LaunchAgent on macOS.
6. **Listen**: on `--listen`, else this machine's Tailscale IPv4 (`tailscale ip -4`), else its one private LAN address.
   Several private addresses and no `--listen` is refused rather than guessed, and so is every interface (`0.0.0.0`).
   Then Remote Runtime starts there.
7. **Pair**: one pairing string, read-only unless `--full-control`. `--json` adds the machine name (`--name`, else the
   host name), OS, address and fingerprint.

It is refused inside an agent session. Then sign the accounts in, from any terminal on that machine:

```text
astera accounts login --new --label work
```

It makes a new account folder, registers it as an Astera account and runs Claude's own login for it: open the link it
prints on any device and paste the code back. An account that did not sign in is not kept.

## Set up the Runtime

On the machine that will do the work, in the Astera app: Settings › Integrations › Remote Runtimes › This computer. Choose the address
to accept connections on (this machine's LAN or Tailscale addresses, or this computer only; every interface is not
offered) and turn it on. Once it is on, the same place makes a pairing string (read-only or full control, with a name;
it shows the time left and a copy button), lists the paired controllers with an Unpair button each, and turns it off.

Or from a shell, with Astera's command line turned on (Settings › Integrations › CLI):

```text
astera runtime start --listen 100.64.0.5     listen on that address (default 127.0.0.1, port 47831)
astera projects add --path D:\work\repo        a folder the controllers may run in
astera runtime pair --full-control --name laptop   a one-time pairing string, valid 10 minutes
```

`--listen` takes an address of that machine, such as its Tailscale or LAN address. `start` makes this machine's
identity the first time (a key and certificate kept owner-only in the profile), starts a Host if none runs, and waits
until it listens. Every later Host start, by the app or a command, listens again while Remote is on.

**Projects.** A controller starts sessions only in the Runtime's registered projects; a folder that is not one is
refused. Register them on the Runtime, with `astera projects add` or in the app. Jobs are not held to projects: a
full-control controller can run a Job in any folder of the Runtime, and the app lists it under "Unregistered" for that
Runtime.

**Accounts.** The Claude and Codex accounts a Runtime uses are signed in on the Runtime machine, in the Astera app, once.
With no desktop there, `astera accounts login --new` signs one in from a terminal (see One-command setup).
A controller picks among them; no credential ever travels to or from the controller.

## Pair a controller

Pair with the string the Runtime prints. `astera runtime pair` prints one string,
`astera-pair:v1:<address>:<port>:<code>:<fingerprint>`, and its parts. The code is a secret that works once, for 10
minutes, and five wrong tries burn it. Give the string to the controller directly; do not paste it into a chat or a
ticket. A pairing is read-only unless `--full-control` is given: a read-only controller may read but not change
anything. Give full control only to a controller that runs Jobs or sessions there.

In the app: Settings › Integrations › Remote Runtimes, paste the string, Pair. From the command line:

```text
astera runtimes add --pair -
astera runtimes list
```

`--pair -` reads the string from standard input: paste it and end the input (Ctrl+D, or Ctrl+Z then Enter on Windows),
or pipe it in. Prefer it to `--pair '<string>'`: a value on the command line is in the process list, where another user
of the machine can read it and redeem the code first, and in your shell history. `--code -` and `--fingerprint -` work
the same way.

A Runtime names itself with an id, and makes a new id whenever it makes a new key, so a reinstalled Runtime pairs as a
new one. If a Runtime paired here already has that id under another key, another machine is claiming to be it: the
pairing is refused with `CONFLICT` and the paired one is left as it was. Only if you know why, `astera runtimes add`
with `--replace` lets it take that place.

The controller checks the Runtime's key against the fingerprint in the string **before** it sends the code. A different
key is refused with `RUNTIME_IDENTITY_CHANGED` and nothing is sent. `--address` reaches the Runtime at another address
than the one in the string (a Tailscale name, a NAT). Without `--pair`, give `--address`, `--code` and
`--fingerprint`; the fingerprint is required, since the command line cannot show you a key and ask.

The token the Runtime issues is kept in the controller's profile, readable by its user only. It is never printed, and
never read from an argument or an environment variable.

## Use it from the Astera app

- **Jobs.** The Jobs view has a runtime selector: pick the Runtime, then one of its projects. Its Jobs, Runs, Tasks,
  timeline, completion checks and questions show as they are on the Runtime; with a full-control pairing you create,
  run, pause, resume, merge and delete them there. A read-only pairing shows the same screens with the controls off
  and says why.
- **Changed files.** A Run's detail lists the files it changed, from git on the Runtime, beside what its workers
  reported, and opens a file's diff.
- **Sessions.** In the new session dialog, choose where it runs. On a Runtime you open one of its running sessions or
  start a terminal or chat session in one of its projects, on one of its accounts. A remote tab streams the Runtime's
  terminal or conversation; closing the tab leaves the session running there. A roll to another account moves the tab
  with it, and a session that starts waiting for you notifies you here. A terminal session open on both machines has
  one size: the window of the side that typed last. The other side shows the whole screen at a smaller font and says
  so, until someone types there.
- **Offline.** When the Runtime cannot be reached, its screens show the last state they read, marked as not current,
  and never as failed. Work on the Runtime goes on.

## Found on your network

While Remote is on, a Runtime says it is there to the computers on its network, so the Astera app on a controller can
list it under Devices without anyone typing an address. Every 5 seconds the Runtime sends one small UDP multicast
packet to `239.255.71.83`, port **47832**, from its listen address and out of that interface only, one hop (it never
crosses a router). A Runtime listening on `127.0.0.1` sends nothing, and nothing is sent while Remote is off.

The packet is JSON, at most 512 bytes: `{ v, runtimeId, name, port, fingerprint, os, version }`, that is the Runtime's
id, its display name, the Gateway's TCP port, its TLS key's public fingerprint, its OS and its Astera version. **It
holds no secret**: never a token, a pairing code, an account or a project, and a controller reads nothing else from it.
To stop it, block outgoing UDP port 47832 on the Runtime (or incoming on the controller).

The app listens only once its Devices list asks, until it quits, and forgets a Runtime it has not heard for 20 seconds.
Beside the beacons it lists the online Linux and Windows peers of `tailscale status --json`; with no Tailscale it lists
the beacons alone. Each device is marked paired (a Runtime paired here, under the same fingerprint) or found.

**A paired Runtime that moves is followed.** When a paired Runtime's beacon arrives from another address (its Wi-Fi
got a new address from DHCP), the app connects there with the pinned TLS key and signs in; only once that succeeds does
it store the new address and use it. A beacon under the Runtime's id with a different fingerprint is ignored, and a
failed sign-in changes nothing (it is tried again at that address after a minute). A beacon can make the app try an
address, never trust one: the pin decides. The app's log names only the runtime id and the address.

## Use it from the command line

Put `--runtime <id|name>` before the command:

```text
astera --runtime office projects list
astera --runtime office accounts list
astera --runtime office jobs create --objective "fix the flaky test" --cwd 'D:\work\repo'
astera --runtime office jobs run --id <jobId>
astera --runtime office runs follow --id <runId>
astera --runtime office questions answer --id <questionId> --answer yes
astera --runtime office runs-changed-files --id <runId>
```

What a Runtime offers is the same list its pairing is checked against:

- **Reads**, at either permission: projects, accounts, Jobs, runs, tasks, questions, run configurations, checks and
  output, `runs wait`, `jobs wait`, `runs follow`, a Run's changed files and diffs, sessions (list, read and their
  facts), GitHub reads, and `requests show` for your own requests.
- **Changes**, with a full-control pairing only: creating, running, stopping and resuming Jobs and runs, adding tasks,
  answering questions, creating, typing into, resizing and ending sessions.
- **Never remotely**: anything on this machine only (`host`, `skills`, `higgsfield`, `mcp`, `runtime`, `runtimes`,
  `projects add`, `browser js`, `app js`), How It Works records, GitHub writes, and the Host's own management.

A command with no remote form is refused with `RUNTIME_CAPABILITY_MISSING` before it reads anything on this machine. In
particular, `--runtime` never falls back to this machine's state file or report queue when the Runtime cannot be
reached: you get `RUNTIME_OFFLINE` instead.

Paths are the Runtime's. `--cwd` and `--project` are sent as typed, and a remote `jobs create` needs `--cwd`: the
controller's own folder means nothing on the Runtime.

## Use it from MCP

Every MCP tool takes an optional `runtimeId` (an id or a name from `list_runtimes`). A tool given one runs on that
Runtime; `list_runtimes` and `get_runtime` list the pairings. A remote tool call is allowed only when all three agree:

1. this machine's MCP settings (MCP access, sessions, GitHub writes), checked here before anything is sent;
2. the list above of what a Runtime offers;
3. the Runtime's pairing of this machine (read-only or full-control), checked on the Runtime.

For a remote call, an MCP access value Astera does not recognize counts as off.

The first check runs on this machine. An agent that can run `astera --runtime x` directly has the command line's
authority, which is the pairing's: the MCP settings limit MCP clients, not the person's own shell.

## Keep it running: OS recipes

`astera runtime serve` keeps exactly one Host running on this profile while Remote is on and restarts a Host that
crashes (after 1, 2, 5, then 30 seconds). It exits 0 when it is stopped (SIGTERM, Ctrl+C); 75 when an update begins
while it runs (the app writes an update hold and retires the Host), so nothing of the old version stays open and its
supervisor starts the new one; and 78 when this machine cannot start a Host at all (Astera's command line was never set
up there). A `serve` started during an update waits for it to finish. It never turns Remote on by itself: run
`astera runtime start` once first. Each recipe below starts `serve` and starts it again after any exit but 0 and 78.

On a Runtime supervised this way, run `astera runtime stop` before `astera host stop`: while Remote is on, `serve`
starts a new Host after a stop.

### Windows

A logon task for your own user that runs a small PowerShell script around `astera runtime serve`. Save the script as
`%LOCALAPPDATA%\astera\runtime-serve.ps1`:

```powershell
param([string]$Astera = "$env:LOCALAPPDATA\astera\bin\astera.cmd", [string]$Hold = "$env:APPDATA\astera\host\update-hold")
while ($true) {
  # An update in progress: start nothing until its hold ends, so no file of the old version is held.
  if (Test-Path $Hold) {
    $until = (Get-Content $Hold -Raw | ConvertFrom-Json).until
    if ($until -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) { Start-Sleep 10; continue }
  }
  # Astera's command line is gone (uninstalled, or turned off in Settings): stop rather than retry.
  if (-not (Test-Path $Astera)) { exit 1 }
  & $Astera runtime serve
  # 0: stopped on purpose. 78: a configuration no restart changes. Anything else (75 after an update, a crash): again.
  if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 78) { exit $LASTEXITCODE }
  Start-Sleep 5
}
```

Then register the task, in PowerShell:

```powershell
$script   = "$env:LOCALAPPDATA\astera\runtime-serve.ps1"
$action   = New-ScheduledTaskAction -Execute 'powershell.exe' `
            -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Astera Runtime' -Action $action -Trigger $trigger -Settings $settings
```

The script is the restart: Task Scheduler's own "restart on failure" does not restart a task whose program exits with
an error code. `astera.cmd` runs from the app's install folder, so the script waits out an update's hold and `serve`
leaves when one begins: the installer then finds no Astera program running. A task for your own user needs no
administrator. A task that runs before you log in (the "run whether the user is logged on or not" kind, S4U) needs an
administrator to register, so this recipe starts at login. Measured on Windows 11 with a standard user: the task
registers and runs with no window; `serve` brought a killed Host back within 20 seconds and the loop a killed `serve`
within 12; the script waited out a hold, ran again after a 75, and stopped at 0, at 78 and when `astera.cmd` was gone.

To remove it, unregister the task first (`Unregister-ScheduledTask -TaskName 'Astera Runtime'`), then delete the script;
do this before you uninstall Astera or turn its command line off.

### macOS

A LaunchAgent that runs `astera runtime serve`, `~/Library/LaunchAgents/run.astera.runtime.plist` (replace `you` with
your user name):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>run.astera.runtime</string>
  <key>ProgramArguments</key>
  <array><string>/Users/you/.local/bin/astera</string><string>runtime</string><string>serve</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/Users/you/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
</dict>
</plist>
```

```text
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/run.astera.runtime.plist
```

A LaunchAgent runs once you log in. Claude keeps its sign-in in your login keychain, which is locked until you log in,
so Claude sessions and workers on a macOS Runtime start only after a login. `PATH` must include the folders `claude`
and `codex` are installed in. Remove it with `launchctl bootout gui/$(id -u)/run.astera.runtime` and delete the file.

This recipe has not been measured on a Mac yet; the Windows and Linux ones have.

### Linux

A systemd user unit, `~/.config/systemd/user/astera-runtime.service`:

```ini
[Unit]
Description=Astera Runtime

[Service]
ExecStart=%h/.local/bin/astera runtime serve
Restart=on-failure
RestartSec=5
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
```

```text
systemctl --user daemon-reload
systemctl --user enable --now astera-runtime
loginctl enable-linger $USER      start it at boot, before you log in
```

A user unit does not read your shell's profile: add to `PATH` the folders `claude` and `codex` are installed in (the
npm global folder, for example), or they are not found; the Host and its workers get exactly this `PATH`. Remove it with
`systemctl --user disable --now astera-runtime` and `loginctl disable-linger $USER`.

Measured on Ubuntu 22.04 with systemd: with linger on, the unit started at boot with no one logged in; systemd brought a
killed `serve` back (`Restart=on-failure`) and `serve` brought a killed Host back within 20 seconds; a Windows
controller paired with it listed its project, and each file's diff matched `git diff` on the Runtime, case-only
renames and Unicode names included.

## Security

- The Runtime listens with a TLS key made on that machine; a controller pins its fingerprint at pairing and refuses a
  different key from then on.
- Each controller has its own token, kept owner-only on both sides, never printed, never in an argument or the
  environment. Revoking it closes its connections at once.
- A controller reads and changes Jobs, Runs, Tasks and sessions by their ids. It has no command to read or write an
  arbitrary file, list a folder, or run a shell on the Runtime. A Run's changed files and diffs come from git, by file
  ids the Runtime gave.
- **Full control is the Runtime user's power.** A full-control controller starts agents and terminal sessions there and
  types into them, and those run any command the Runtime's user can, in any folder that user can reach. Pair with full
  control only a controller you would trust with that user account; the rest keep the read-only default.
- Logs on both sides never carry tokens, pairing codes or terminal output.
- Connections that have not signed in have a budget of their own, and few from one address, so sockets that say nothing
  cannot hold paired controllers off. One pairing holds at most twelve connections at once, and a controller closes a
  connection it has not used for two minutes, so idle agent sessions with Astera MCP do not hold them. More than 32
  sockets from one address are dropped before TLS, which the controller reports as `RUNTIME_OFFLINE`.
- A controller that asks and never reads its answers is closed: once its output has not moved for 45 seconds, or when
  answers waiting for every controller pass their budget and it holds the most. An answer that cannot be sent for that
  budget is `RUNTIME_BUSY` for a read, and `RUNTIME_OUTCOME_UNKNOWN` for a change, which ran: ask again with the same
  request id to read its answer.
- `astera runtime start`, `astera runtime pair` and `astera projects add` are refused inside an agent session Astera
  started (`ASTERA_SESSION` is set): opening this machine to the network is for a person, at their own shell or in the
  app.
- `astera runtime status` and `astera runtime clients` carry `health`. `burnedCodes` counts pairing codes that wrong
  guesses used up since the Host started: if it is not 0 and you did not mistype, someone who can reach the port is
  guessing. `unsavedRevocations` names controllers revoked here whose revocation could not be written to disk yet; the
  Host keeps trying, and they stay refused meanwhile, but a Host restart before it lands would let them back in.

## When an answer is lost

A command that changes something carries a request id. If the connection drops before its answer comes back, the
controller reconnects (waiting 1 s, 2 s, 5 s, 10 s, then 30 s, with jitter) and sends the same command again with the
same id, marked as a retry. The Runtime then answers with what the first attempt did, and never runs it twice. When it
cannot say (the first attempt never arrived, or the Runtime restarted since), the answer is `RUNTIME_OUTCOME_UNKNOWN`:
list the newest Jobs or runs on that Runtime before trying again.

## Revoke and remove

- On the Runtime: Unpair beside a controller in Settings › Integrations › Remote Runtimes › This computer (on or off), or list
  them with `astera runtime clients` and unpair one with `astera runtime revoke --id <clientId>`. Its next command
  is refused with `RUNTIME_AUTH_FAILED`, and its open connections close.
- On the controller: `astera runtimes remove --id <runtimeId|name>`, or Remove in Settings › Integrations › Remote Runtimes, forgets
  the Runtime here. It does **not** revoke the pairing on the Runtime.
- Turning off (in Settings › Integrations › Remote Runtimes › This computer, or with `astera runtime stop`) stops listening and
  spends any pairing string not used yet. Pairings stay, the Host and its Jobs keep running.

## Troubleshooting

- **`RUNTIME_OFFLINE`.** Check that the Runtime machine is on and reachable at that address (`ping`, your VPN's
  status), and that `astera runtime status` there says the Gateway listens. A Runtime listening on `127.0.0.1` is not
  reachable from another machine: start it with `--listen` on its LAN or VPN address.
- **`RUNTIME_IDENTITY_CHANGED`.** The machine at that address is not the one you paired, or its profile was replaced.
  If you trust the change, remove the Runtime and pair again with a new string.
- **`RUNTIME_AUTH_FAILED`.** The Runtime revoked this controller, or its profile lost the pairing. Pair again.
- **A pairing string is refused.** It works once, for 10 minutes, and five wrong tries burn it. Run
  `astera runtime pair` again, with `--full-control` if this controller is to change things there.
- **The Runtime does not come back after a reboot.** Check the OS recipe: the task, LaunchAgent or unit exists and
  runs `astera runtime serve`, and Remote is on (`astera runtime status`).
- **Sessions or workers fail to start on the Runtime.** Sign the Runtime's accounts in there, in the Astera app; under
  a service, `claude` and `codex` must be on the recipe's `PATH`.
- **`RUNTIME_CAPABILITY_MISSING` for a newer feature.** The Runtime runs an older Astera; update it there.

## Error codes

| Code | Exit | Meaning |
|---|---|---|
| `RUNTIME_NOT_FOUND` | 4 | no paired Runtime has that id or name, or a name matches two; for a remote terminal, the pty is not on the Runtime any more |
| `RUNTIME_OFFLINE` | 3 | the Runtime could not be reached |
| `RUNTIME_AUTH_FAILED` | 5 | the Runtime does not know this controller: revoked, or never paired |
| `RUNTIME_IDENTITY_CHANGED` | 5 | the Runtime's key is not the one pinned at pairing |
| `RUNTIME_PROTOCOL_MISMATCH` | 9 | the two machines speak different remote protocols; update the older |
| `RUNTIME_CAPABILITY_MISSING` | 9 | the command has no remote form, or that Runtime cannot do it |
| `RUNTIME_BUSY` | 6 | too many connections or calls in flight on the Runtime; try again shortly |
| `RUNTIME_PERMISSION_DENIED` | 5 | a read-only pairing asked for a change; pair again with `astera runtime pair --full-control` on the Runtime |
| `RUNTIME_OUTCOME_UNKNOWN` | 6 | an answer was lost and the Runtime cannot say whether the change ran |
| `REMOTE_TIMEOUT` | 7 | no answer in time; the command may still finish |
| `REMOTE_REPLY_TOO_LARGE` | 1 | the answer was over 64 MiB |

The code is in `error.code` of the envelope; read it from there, never from the sentence. `RUNTIME_PROJECT_NOT_FOUND`,
`RUNTIME_ACCOUNT_NOT_FOUND` and `REMOTE_OPERATION_CONFLICT` are reserved names this version does not send: a missing
project or account, or a refusal because of the Runtime's state, comes back with the Runtime's own error.
