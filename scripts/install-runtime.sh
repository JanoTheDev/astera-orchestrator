#!/usr/bin/env bash
# Makes this Ubuntu or Debian machine an Astera Runtime in one command (docs/remote-runtime.md, "One-command setup").
#
#   bash install-runtime.sh <path-to-astera.deb> [astera runtime setup flags, e.g. --tailscale --full-control]
#
# Installs the .deb with apt, turns on linger so the Runtime runs with nobody logged in, then runs
# `astera runtime setup --yes` with the flags given. No display is needed. The last line it prints is
# ASTERA_PAIR=<pairing string>: give that string to the controller and to nothing else, it holds a one-time code.
set -euo pipefail

die() { echo "install-runtime: $*" >&2; exit 1; }

[ $# -ge 1 ] || die "usage: bash install-runtime.sh <path-to-astera.deb> [setup flags]"
deb=$1
shift
[ -f "$deb" ] || die "no .deb at $deb"
# The Runtime belongs to a user: its service is a systemd user unit and its accounts live in that user's home.
[ "$(id -u)" -ne 0 ] || die "run this as the user the Runtime belongs to, not root; it asks sudo for apt"
command -v apt-get >/dev/null || die "this script needs apt (Ubuntu or Debian)"

deb=$(readlink -f "$deb")
sudo apt-get update
sudo apt-get install -y "$deb"
# sudo is warm from apt: linger here saves setup a polkit prompt on a machine nobody is logged in to.
sudo loginctl enable-linger "$(id -un)"

app=/opt/Astera/astera
cli=/opt/Astera/resources/app.asar/out/main/cli.js
[ -x "$app" ] || die "the .deb did not install $app"

out=$(mktemp)
trap 'rm -f "$out"' EXIT
# The app's own binary as Node: the CLI needs no X11 or Wayland. Steps go to stderr, the JSON answer to $out.
if ! ELECTRON_RUN_AS_NODE=1 "$app" "$cli" runtime setup --yes --json "$@" >"$out"; then
  cat "$out" >&2
  die "astera runtime setup failed"
fi
pair=$(ELECTRON_RUN_AS_NODE=1 "$app" -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0, "utf8")).data.pairing))' <"$out")
case "$pair" in
  astera-pair:v1:*) ;;
  *) die "setup answered without a pairing string" ;;
esac
echo "ASTERA_PAIR=$pair"
