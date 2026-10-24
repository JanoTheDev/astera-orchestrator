#!/bin/sh
# Builds the Linux AppImage, starts it so it repoints the installed `astera` command at itself,
# then deletes the AppImage the command named before.
#   sh scripts/build.sh [--dry-run]   (--dry-run prints the decisions and builds nothing)
# Heavy job: do not run it next to Electron or a full vitest run.
set -e
cd "$(dirname "$0")/.."
CLI="$HOME/.local/bin/astera"

# The AppImage path the installed command runs today (empty when the command is not installed).
appimage_of() { [ -f "$CLI" ] && grep -o '"[^"]*\.AppImage"' "$CLI" | tr -d '"' || true; }
OLD=$(appimage_of)

# Pids of processes started from $OLD, as "<pid> window" or "<pid> host". A plain `pgrep -f "$OLD"` only sees
# the AppImage runtime wrapper: the Host's argv names the /tmp/.mount_* path, not $OLD. What every process of
# an AppImage does carry is APPIMAGE=$OLD in its environment. The Host runs with ELECTRON_RUN_AS_NODE=1 and
# holds no single-instance lock, so only a non-Node process whose binary lives in its own mount (APPDIR) is
# an app window; a worker or dev server that merely inherited APPIMAGE is neither.
procs_of_old() {
  [ -n "$OLD" ] || return 0
  for d in /proc/[0-9]*; do
    env=$({ tr '\0' '\n' <"$d/environ"; } 2>/dev/null) || continue
    printf '%s\n' "$env" | grep -Fxq "APPIMAGE=$OLD" || continue
    if printf '%s\n' "$env" | grep -Fxq "ELECTRON_RUN_AS_NODE=1"; then echo "${d#/proc/} host"; continue; fi
    appdir=$(printf '%s\n' "$env" | sed -n 's/^APPDIR=//p')
    case "$(readlink "$d/exe" 2>/dev/null)" in "$appdir"/*) { tr '\0' ' ' <"$d/cmdline"; } 2>/dev/null | grep -q -- '--type=' || echo "${d#/proc/} window";; esac
  done
}

DRY=0; [ "$1" = "--dry-run" ] && DRY=1
PROCS=$(procs_of_old)
WINDOW=$(printf '%s\n' "$PROCS" | awk '$2 == "window" {print $1; exit}')
HOST=$(printf '%s\n' "$PROCS" | awk '$2 == "host" {print $1; exit}')

# A running window holds the single-instance lock and would take the launch, so nothing would repoint.
# A Host alone does not: the new app replaces it itself. Checked before the build, which may write over
# the very AppImage that is running.
if [ "$DRY" = 1 ]; then
  echo "old AppImage: ${OLD:-none}"
  echo "app window running: $([ -n "$WINDOW" ] && echo "yes (pid $WINDOW) -> refuse" || echo no)"
  echo "old Host running: $([ -n "$HOST" ] && echo "yes (pid $HOST) -> never killed" || echo no)"
  echo "delete old AppImage after the build: $([ -n "$OLD" ] && echo yes || echo "no (none)")"
  exit 0
fi
if [ -n "$WINDOW" ]; then
  echo "Astera ($OLD) is running (pid $WINDOW); quit the window first" >&2; exit 1
fi

npm run dist:linux
NEW="$PWD/dist-installer/$(ls -t dist-installer | grep '\.AppImage$' | head -n 1)"
[ -f "$NEW" ] || { echo "no AppImage in dist-installer/" >&2; exit 1; }

nohup "$NEW" --no-sandbox >/dev/null 2>&1 &
if [ ! -f "$CLI" ]; then
  echo "started $NEW; the astera command is not installed (Settings > CLI installs it)"; exit 0
fi
i=0
until [ "$(appimage_of)" = "$NEW" ]; do
  i=$((i + 1)); [ "$i" -le 60 ] || { echo "astera command still names $OLD after 60s; old AppImage kept" >&2; exit 1; }
  sleep 1
done
echo "astera command now runs $NEW"
[ -z "$HOST" ] || echo "old Host (pid $HOST) still running; the new app takes it over by itself, or asks you once if this Host predates handovers"

# Safe while the old Host runs: its FUSE mount keeps the AppImage open, and unlinking an open file leaves it readable.
if [ -n "$OLD" ] && [ "$OLD" != "$NEW" ] && [ -f "$OLD" ]; then
  rm -f "$OLD" && echo "deleted $OLD"
fi
