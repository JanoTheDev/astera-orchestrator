#!/bin/sh
# Builds the Linux AppImage, starts it so it repoints the installed `astera` command at itself,
# then deletes the AppImage the command named before.
#   sh scripts/build.sh
# Heavy job: do not run it next to Electron or a full vitest run.
set -e
cd "$(dirname "$0")/.."
CLI="$HOME/.local/bin/astera"

# The AppImage path the installed command runs today (empty when the command is not installed).
appimage_of() { [ -f "$CLI" ] && grep -o '"[^"]*\.AppImage"' "$CLI" | tr -d '"' || true; }
OLD=$(appimage_of)

# One Astera at a time (single-instance lock): a running one would take the launch and nothing repoints.
# Checked before the build, which may write over the very AppImage that is running.
if [ -n "$OLD" ] && pgrep -f "$OLD" >/dev/null; then
  echo "Astera ($OLD) is running; quit it first" >&2; exit 1
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

if [ -n "$OLD" ] && [ "$OLD" != "$NEW" ] && [ -f "$OLD" ]; then
  rm -f "$OLD" && echo "deleted $OLD"
fi
